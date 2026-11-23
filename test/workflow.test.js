import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../src/server/server.js';
import {example,validateDocument,validateAnswers} from '../src/server/document.js';
import {openDatabase} from '../src/server/storage/database.js';

const password='test-password-for-lina';
const image={kind:'image',value:'https://example.org/cat.png'};
const text=value=>({kind:'text',value});
const question=(type,fields)=>({type,prompt:'Prompt for '+type,options:[],solution:'',pairs:[],cards:[],media:[],...fields});
const doc={title:'Homework',description:'Six exercises',sections:[{title:'Exercises',questions:[
  question('choice',{options:['yes','no']}),question('multi',{options:['a','b','c']}),
  question('text'),question('hangman',{solution:'ice cream'}),
  question('match',{pairs:[{left:image,right:text('cat')},{left:{...image,value:'https://example.org/dog.png'},right:text('dog')}]}),
  question('flash',{cards:[{front:text('cat'),back:image}]})
]}]};
const answers=['yes',['a','b'],'Answer','Solved: ICE CREAM',[1,0],'1 / 1'];
test('schema and answer validation for six exercise types',()=>{
  assert.equal(validateDocument(doc),doc);
  assert.equal(validateDocument(example),example);
  validateAnswers(doc,answers);
  assert.throws(()=>validateAnswers(doc,[...answers.slice(0,4),[0,0],answers[5]]));
  assert.throws(()=>validateAnswers(doc,['maybe',...answers.slice(1)]));
  assert.throws(()=>validateAnswers(doc,['yes',['a','a'],...answers.slice(2)]));
  assert.throws(()=>validateDocument({...doc,title:' '}));
  assert.throws(()=>validateDocument({...doc,sections:[]}));
  const bad=structuredClone(doc);
  bad.sections[0].questions[0].media=[{kind:'image',url:'javascript:void(0)'}];
  assert.throws(()=>validateDocument(bad));
});
test('publish, submit, restart, review, grade, and archive',async t=>{
  const dataDir=mkdtempSync(join(tmpdir(),'linas-homeworks-'));
  let server;
  let base;
  async function start(){
    server=createApp({dataDir,password,secure:false}).listen(0,'127.0.0.1');
    await once(server,'listening');
    base='http://127.0.0.1:'+server.address().port;
  }
  async function close(){if(server?.listening) await new Promise(resolve=>server.close(resolve));}
  t.after(async()=>{await close();rmSync(dataDir,{recursive:true,force:true});});
  await start();
  let cookie;
  async function call(path,{method='GET',body,auth=false,file,headers={}}={}){
    if(body!==undefined) headers['Content-Type']='application/json';
    if(auth) headers.Cookie=cookie;
    const res=await fetch(base+path,{method,headers,body:file||(body===undefined?undefined:JSON.stringify(body))});
    const value=res.headers.get('content-type')?.includes('json')?await res.json():await res.arrayBuffer();
    return {status:res.status,value,headers:res.headers};
  }
  assert.equal((await call('/api/health')).status,200);
  assert.equal((await call('/api/admin/assignments')).status,401);
  assert.equal((await call('/api/login',{method:'POST',body:{password:'wrong'}})).status,401);
  const login=await call('/api/login',{method:'POST',body:{password}});
  assert.equal(login.status,200);
  cookie=login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  assert.equal((await call('/api/admin/assignments',{method:'POST',body:{document:doc},auth:true,headers:{Origin:'https://other.example'}})).status,403);
  const dueAt='2020-01-01T00:00:00.000Z';
  const created=await call('/api/admin/assignments',{method:'POST',auth:true,body:{document:doc,dueAt}});
  assert.equal(created.status,201);
  const {code}=created.value;
  const admin='/api/admin/assignments/'+code;
  const student='/api/homework/'+code;
  for (const title of ['Algebra', 'Biology']) {
    assert.equal((await call('/api/admin/assignments',{method:'POST',auth:true,body:{document:{...doc,title}}})).status,201);
  }
  const firstPage=await call('/api/admin/assignments?limit=1', {auth:true});
  assert.equal(firstPage.value.items.length,1);
  assert.equal(firstPage.value.total,3);
  assert.ok(firstPage.value.nextCursor);
  const secondPage=await call('/api/admin/assignments?limit=1&cursor='+encodeURIComponent(firstPage.value.nextCursor), {auth:true});
  assert.equal(secondPage.value.items.length,1);
  assert.notEqual(secondPage.value.items[0].code,firstPage.value.items[0].code);
  assert.equal((await call('/api/admin/assignments?limit=10&q=biology', {auth:true})).value.total,1);
  assert.equal((await call('/api/admin/assignments?limit=10&status=wrong', {auth:true})).status,400);
  assert.equal((await call(student)).status,404);
  assert.equal((await call(admin,{auth:true})).value.dueAt,dueAt);
  assert.equal((await call(admin,{method:'PUT',auth:true,body:{status:'published'}})).status,200);
  const {value:loaded}=await call(student);
  const matching=loaded.document.sections[0].questions[4];
  assert.deepEqual(matching.pairs,[]);
  assert.deepEqual(matching.matchRight,[text('dog'),text('cat')]);
  const submit={name:'=SUM(1,1)',answers,attemptId:'1234567890abcdefghijklmnopqrstuv',revision:loaded.revision};
  assert.equal((await call(student+'/submissions',{method:'POST',body:{...submit,revision:0}})).status,409);
  const sent=await call(student+'/submissions',{method:'POST',body:submit});
  assert.equal(sent.status,201);
  const result='/api/results/'+sent.value.token;
  assert.deepEqual((await call(student+'/submissions',{method:'POST',body:submit})).value,sent.value);
  assert.equal((await call(result)).value.score,null);
  assert.equal((await call(result)).value.late,true);
  assert.equal((await call(student)).status,200);
  await close();
  await start();
  const {value:[work]}=await call(admin+'/submissions',{auth:true});
  assert.equal(work.name,'=SUM(1,1)');
  assert.deepEqual(work.answers,answers);
  assert.equal(work.dueAt,dueAt);
  assert.equal(work.late,true);
  assert.deepEqual(work.document.sections[0].questions[4].matchRight,matching.matchRight);
  const grade='/api/admin/submissions/'+work.id;
  assert.equal((await call(grade,{method:'PATCH',auth:true,body:{score:11,maxScore:10,feedback:''}})).status,400);
  assert.equal((await call(grade,{method:'PATCH',auth:true,body:{score:0,maxScore:10,feedback:'Try again'}})).status,200);
  assert.equal((await call(result)).value.score,0);
  assert.equal((await call(result)).value.feedback,'Try again');
  const csv=await fetch(base+admin+'/export.csv',{headers:{Cookie:cookie}});
  assert.equal(csv.status,200);
  const csvText=await csv.text();
  assert.match(csvText,/assignment_code/);
  assert.match(csvText,/"'=SUM\(1,1\)"/);
  assert.match(csvText,/"true"/);
  const changedDueAt='2099-01-01T00:00:00.000Z';
  assert.equal((await call(admin,{method:'PUT',auth:true,body:{dueAt:changedDueAt}})).status,200);
  assert.equal((await call(result)).value.late,true);
  assert.equal((await call(admin,{method:'PUT',auth:true,body:{status:'archived'}})).status,200);
  assert.equal((await call(student)).status,404);
  assert.equal((await call(result)).status,200);
  const uploaded=await call('/api/admin/media',{method:'POST',auth:true,headers:{'X-Upload':'1','Content-Type':'image/png'},file:Buffer.from('89504e470d0a1a0a','hex')});
  assert.equal(uploaded.status,201);
  assert.equal((await call(uploaded.value.url,{headers:{Range:'bytes=1-2'}})).status,206);
  assert.equal((await call(uploaded.value.url,{headers:{Range:'bytes=99-'}})).status,416);
  assert.equal((await call('/api/admin/media',{method:'POST',auth:true,headers:{'X-Upload':'1','Content-Type':'image/png'},file:Buffer.from('wrong')})).status,415);
  assert.equal((await call('/api/logout',{method:'POST',auth:true,body:{}})).status,200);
  assert.equal((await call(admin+'/submissions',{auth:true})).status,401);
});

test('migrates a database created before deadline columns existed', t=>{
  const dataDir=mkdtempSync(join(tmpdir(),'linas-homeworks-migration-'));
  const path=join(dataDir,'homework.sqlite');
  const legacy=new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT NOT NULL, name TEXT NOT NULL);
    INSERT INTO users VALUES(1,'admin','Lina');
    CREATE TABLE sessions(hash TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE assignments(code TEXT PRIMARY KEY, status TEXT NOT NULL, revision INTEGER NOT NULL, document TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE submissions(
      id INTEGER PRIMARY KEY, code TEXT NOT NULL REFERENCES assignments(code), user_id INTEGER NOT NULL REFERENCES users(id),
      attempt TEXT NOT NULL, token TEXT UNIQUE NOT NULL, document TEXT NOT NULL, answers TEXT NOT NULL,
      score REAL, max_score REAL, feedback TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
      UNIQUE(code,attempt));
    INSERT INTO assignments VALUES('HW-AAAAAAAA','archived',1,'{}','2024-01-01T00:00:00.000Z');
    INSERT INTO users VALUES(2,'student','Legacy Student');
    INSERT INTO submissions(id,code,user_id,attempt,token,document,answers,created_at)
      VALUES(7,'HW-AAAAAAAA',2,'legacy-attempt','legacy-token','{}','[]','2024-01-02T00:00:00.000Z');
  `);
  legacy.close();
  const migrated=openDatabase(dataDir);
  try {
    const assignmentColumns=migrated.prepare('PRAGMA table_info(assignments)').all().map(column=>column.name);
    const submissionColumns=migrated.prepare('PRAGMA table_info(submissions)').all().map(column=>column.name);
    assert.ok(assignmentColumns.includes('due_at'));
    assert.ok(submissionColumns.includes('due_at'));
    assert.ok(submissionColumns.includes('marks'));
    assert.equal(migrated.prepare('SELECT submissions.id,name FROM submissions JOIN users ON users.id=user_id WHERE submissions.id=7').get().name,'Legacy Student');
    assert.equal(migrated.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='submissions_due'").get().name,'submissions_due');
  } finally {
    migrated.close();
    rmSync(dataDir,{recursive:true,force:true});
  }
});
