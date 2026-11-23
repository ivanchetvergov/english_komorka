import {createServer} from 'node:http';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,statSync,createReadStream} from 'node:fs';
import {isIP} from 'node:net';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDatabase} from './storage/database.js';
import {check,schema,example,validateDocument,validateAnswers,questions,suggestMarks,validateMarks} from './document.js';

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../web');
const digest = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(24).toString('base64url');
const sessionAge = 8 * 3600;
const mime = {png:'image/png',jpg:'image/jpeg',webp:'image/webp',gif:'image/gif',mp3:'audio/mpeg',mp4:'video/mp4',webm:'audio/webm',ogg:'audio/ogg',wav:'audio/wav'};
const mimeExtensions = Object.fromEntries(Object.entries(mime).map(([ext,type])=>[type,ext]));
const audioExtensions = {webm:'webm',ogg:'ogg',mp4:'mp4',mpeg:'mp3',wav:'wav'};
const hashOrder = (code, revision, index, slot) => digest([code,revision,index,slot].join(':'));
function studentDocument(document,code,revision,review=false) {
  let index=0;
  return {...document,sections:document.sections.map(s=>({...s,questions:s.questions.map(q=>{
    const questionIndex=index++;
    const visible={...q};
    if(!review) delete visible.acceptedAnswers;
    if(q.type!=='match') return visible;
    const order=q.pairs.map((_,i)=>i).sort((a,b)=>hashOrder(code,revision,questionIndex,a).localeCompare(hashOrder(code,revision,questionIndex,b)));
    if(order.every((i,j)=>i===j)) order.push(order.shift());
    return {...visible,pairs:review?q.pairs:[],matchLeft:q.pairs.map(p=>p.left),matchRight:order.map(i=>q.pairs[i].right)};
  })}))};
}
async function readBody(req, limit) {
  check(!(Number(req.headers['content-length'])>limit),'Файл или запрос слишком большой',413);
  let size=0;
  const chunks=[];
  for await (const chunk of req.iterator({destroyOnReturn:false})) {
    size+=chunk.length;
    check(size<=limit,'Файл или запрос слишком большой',413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function json(req, limit=1024*1024) {
  check(req.headers['content-type']?.split(';')[0]==='application/json','Ожидается JSON',415);
  const bytes=await readBody(req,limit);
  let value;
  try { value=JSON.parse(bytes.toString()); } catch { check(false,'Некорректный JSON'); }
  check(value && typeof value==='object' && !Array.isArray(value),'Ожидается объект JSON');
  return value;
}
function validMedia(ext,b) {
  if(ext==='jpg') return b[0]===255&&b[1]===216&&b[2]===255;
  if(ext==='png') return b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
  if(ext==='gif') return /^GIF8[79]a$/.test(b.toString('ascii',0,6));
  if(ext==='webp') return b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP';
  if(ext==='mp4') return b.toString('ascii',4,8)==='ftyp';
  return b.toString('ascii',0,3)==='ID3'||(b.length>2&&b[0]===255&&(b[1]&224)===224);
}
function csvCell(value) {
  let text=value==null?'':String(value);
  if (/^[\s\uFEFF]*[=+@-]/.test(text)) text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
function normalizedDueAt(value) {
  if(value===undefined||value===null||value==='') return null;
  check(typeof value==='string','Укажи корректный срок сдачи');
  check(/(?:Z|[+-]\d{2}:\d{2})$/.test(value),'Срок сдачи должен содержать часовой пояс');
  const date=new Date(value);
  check(Number.isFinite(date.getTime()),'Укажи корректный срок сдачи');
  try { return date.toISOString(); } catch { check(false,'Укажи корректный срок сдачи'); }
}
async function writeChunk(res,chunk) {
  if(res.destroyed) return false;
  if(!res.write(chunk)) {
    await new Promise((resolve,reject)=>{
      const cleanup=()=>{
        res.off('drain',onDrain);
        res.off('close',onClose);
        res.off('error',onError);
      };
      const onDrain=()=>{cleanup();resolve();};
      const onClose=()=>{cleanup();resolve();};
      const onError=error=>{cleanup();reject(error);};
      res.once('drain',onDrain);
      res.once('close',onClose);
      res.once('error',onError);
    });
  }
  return !res.destroyed;
}
function persistAudioAnswers(answers, mediaDir) {
  return answers.map(answer=>{
    if(typeof answer!=='string') return answer;
    const match=answer.match(/^data:audio\/(webm|ogg|mp4|mpeg|wav);base64,([A-Za-z0-9+/]+={0,2})$/);
    if(!match) return answer;
    const bytes=Buffer.from(match[2],'base64');
    const ext=audioExtensions[match[1]];
    const name=digest(bytes)+'.'+ext;
    try { writeFileSync(resolve(mediaDir,name),bytes,{flag:'wx'}); }
    catch(error) { if(error.code!=='EEXIST') throw error; }
    return '/media/'+name;
  });
}
export function createApp({dataDir=process.env.DATA_DIR||'./data',password=process.env.ADMIN_PASSWORD,secure=process.env.COOKIE_SECURE!=='0',trustProxy=process.env.TRUST_PROXY==='1'}={}) {
  if(typeof password!=='string'||password.length<12) throw new Error('Set ADMIN_PASSWORD to at least 12 characters.');
  const mediaDir=resolve(dataDir,'media');
  mkdirSync(mediaDir,{recursive:true});
  const db=openDatabase(dataDir);
  const sql=(query,...params)=>db.prepare(query).run(...params);
  const one=(query,...params)=>db.prepare(query).get(...params);
  const all=(query,...params)=>db.prepare(query).all(...params);
  db.function('unicode_lower',{deterministic:true},value=>typeof value==='string'?value.toLocaleLowerCase('ru'):value);
  for(const row of all("SELECT id,answers FROM submissions WHERE answers LIKE '%data:audio/%'")) {
    const answers=JSON.parse(row.answers);
    const stored=persistAudioAnswers(answers,mediaDir);
    if(JSON.stringify(stored)!==row.answers) sql('UPDATE submissions SET answers=? WHERE id=?',JSON.stringify(stored),row.id);
  }
  const now=()=>new Date().toISOString();
  const passwordHash=Buffer.from(digest(password),'hex');
  const cookie=(res,value,age)=>res.setHeader('Set-Cookie',`lina_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure?'; Secure':''}`);
  const loginFailures=new Map();
  function loginBucket(req) {
    const current=Date.now();
    for(const [address,bucket] of loginFailures) if(current-bucket.startedAt>=60000) loginFailures.delete(address);
    const forwarded=req.headers['x-forwarded-for'];
    const trustedAddress=trustProxy&&typeof forwarded==='string'&&isIP(forwarded.trim())?forwarded.trim():'';
    const address=trustedAddress||req.socket.remoteAddress||'unknown';
    let bucket=loginFailures.get(address);
    if(!bucket||current-bucket.startedAt>=60000) bucket={startedAt:current,count:0};
    loginFailures.delete(address);
    loginFailures.set(address,bucket);
    while(loginFailures.size>10000) loginFailures.delete(loginFailures.keys().next().value);
    check(bucket.count<12,'Слишком много попыток. Попробуй через минуту.',429);
    return {address,bucket};
  }
  function submission(row) {
    const {id,name,score,max_score:maxScore,feedback,created_at:createdAt,due_at:dueAt}=row;
    const document=JSON.parse(row.document);
    const answers=JSON.parse(row.answers);
    const marks=row.marks?JSON.parse(row.marks):null;
    return {id,name,score,maxScore,feedback,createdAt,dueAt,late:Boolean(dueAt&&createdAt>dueAt),document,answers,marks,suggestedMarks:suggestMarks(document,answers)};
  }
  const server=createServer(async (req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; media-src 'self' https: data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const send=(status,data)=>{
      res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      res.end(JSON.stringify(data));
    };
    try {
      const requestUrl=new URL(req.url,'http://local');
      const path=requestUrl.pathname;
      const method=req.method;
      if(method!=='GET'&&method!=='HEAD') {
        check(req.headers['sec-fetch-site']!=='cross-site','Запрос с другого сайта отклонён',403);
        if(req.headers.origin) check(URL.canParse(req.headers.origin)&&new URL(req.headers.origin).host===req.headers.host,'Запрос с другого сайта отклонён',403);
      }
      const session=req.headers.cookie?.match(/(?:^|; *)lina_session=([\w-]{32})(?:;|$)/)?.[1];
      const admin=Boolean(session && one("SELECT 1 FROM sessions JOIN users ON users.id=user_id WHERE hash=? AND expires>? AND role='admin'",digest(session),Date.now()));
      if(path==='/api/health'&&method==='GET') return send(200,{ok:one('SELECT 1 AS ok').ok===1});
      if(path==='/api/session'&&method==='GET') return send(200,{admin});
      if(path==='/api/login'&&method==='POST') {
        const attempt=loginBucket(req);
        const body=await json(req);
        if(typeof body.password!=='string'||!timingSafeEqual(Buffer.from(digest(body.password),'hex'),passwordHash)) {
          attempt.bucket.count++; return send(401,{error:'Неверный пароль'});
        }
        loginFailures.delete(attempt.address);
        if(session) sql('DELETE FROM sessions WHERE hash=?',digest(session));
        sql('DELETE FROM sessions WHERE expires<=?',Date.now());
        const value=token();
        sql('INSERT INTO sessions VALUES(?,1,?)',digest(value),Date.now()+sessionAge*1000);
        cookie(res,value,sessionAge);
        return send(200,{admin:true});
      }
      if(path==='/api/logout'&&method==='POST') {
        await json(req);
        if(session) sql('DELETE FROM sessions WHERE hash=?',digest(session));
        cookie(res,'',0);
        return send(200,{admin:false});
      }
      if(path.startsWith('/api/admin/')) check(admin,'Войди как преподаватель',401);
      if(path==='/api/admin/media'&&method==='POST') {
        check(req.headers['x-upload']==='1','Ожидается загрузка файла',415);
        const ext=mimeExtensions[req.headers['content-type']];
        check(ext&&Object.hasOwn(mime,ext),'Формат файла не поддерживается',415);
        const bytes=await readBody(req,20*1024*1024);
        check(validMedia(ext,bytes),'Файл не соответствует формату',415);
        const name=digest(bytes)+'.'+ext;
        writeFileSync(resolve(mediaDir,name),bytes);
        return send(201,{url:'/media/'+name});
      }
      if(path==='/api/admin/assignments') {
        if(method==='GET') {
          if(!requestUrl.searchParams.has('limit')) {
            return send(200,all('SELECT * FROM assignments ORDER BY created_at DESC,code DESC').map(a=>({...a,document:JSON.parse(a.document)})));
          }
          const limit=Number(requestUrl.searchParams.get('limit'));
          const offset=Number(requestUrl.searchParams.get('offset')??0);
          let cursor=null;
          const query=(requestUrl.searchParams.get('q')??'').trim();
          const status=requestUrl.searchParams.get('status')??'all';
          check(Number.isInteger(limit)&&limit>=1&&limit<=100,'Размер страницы должен быть от 1 до 100');
          check(Number.isInteger(offset)&&offset>=0&&offset<=10000000,'Неверное смещение страницы');
          check(query.length<=140,'Поисковый запрос слишком длинный');
          check(['all','draft','published','archived'].includes(status),'Неверный статус');
          if(requestUrl.searchParams.has('cursor')) {
            const encoded=requestUrl.searchParams.get('cursor');
            check(encoded.length<=200&&/^[A-Za-z0-9_-]+$/.test(encoded),'Неверный курсор страницы');
            try { cursor=JSON.parse(Buffer.from(encoded,'base64url').toString()); }
            catch { check(false,'Неверный курсор страницы'); }
            check(Array.isArray(cursor)&&cursor.length===2&&typeof cursor[0]==='string'
              &&typeof cursor[1]==='string'&&/^HW-[A-F0-9]{8}$/.test(cursor[1]),'Неверный курсор страницы');
          }
          const filters=[];
          const values=[];
          if(status!=='all') { filters.push('status=?'); values.push(status); }
          if(query) {
            filters.push("(instr(unicode_lower(json_extract(document,'$.title')),unicode_lower(?))>0 OR instr(upper(code),upper(?))>0)");
            values.push(query,query);
          }
          const where=filters.length?' WHERE '+filters.join(' AND '):'';
          const total=one('SELECT COUNT(*) AS total FROM assignments'+where,...values).total;
          const pageFilters=[...filters];
          const pageValues=[...values];
          if(cursor) { pageFilters.push('(created_at,code)<(?,?)'); pageValues.push(cursor[0],cursor[1]); }
          const pageWhere=pageFilters.length?' WHERE '+pageFilters.join(' AND '):'';
          const rows=all("SELECT code,status,revision,created_at,due_at,json_extract(document,'$.title') AS title,"
            +'(SELECT COUNT(*) FROM submissions s WHERE s.code=assignments.code) AS submission_count,'
            +'(SELECT COUNT(*) FROM submissions s WHERE s.code=assignments.code AND s.score IS NULL) AS pending_count,'
            +'(SELECT COUNT(*) FROM submissions s WHERE s.code=assignments.code AND s.due_at IS NOT NULL AND s.created_at>s.due_at) AS late_count '
            +'FROM assignments'+pageWhere+' ORDER BY created_at DESC,code DESC LIMIT ? OFFSET ?',...pageValues,limit+1,offset);
          const hasMore=rows.length>limit;
          const items=rows.slice(0,limit);
          const last=items.at(-1);
          const nextCursor=hasMore?Buffer.from(JSON.stringify([last.created_at,last.code])).toString('base64url'):null;
          return send(200,{items,total,nextOffset:hasMore?offset+items.length:null,nextCursor});
        }
        if(method==='POST') {
          const {document,dueAt}=await json(req,8*1024*1024);
          validateDocument(document);
          const due=normalizedDueAt(dueAt);
          let code;
          do { code='HW-'+randomBytes(4).toString('hex').toUpperCase(); } while(one('SELECT 1 FROM assignments WHERE code=?',code));
          sql('INSERT INTO assignments(code,status,revision,document,created_at,due_at) VALUES(?,?,?,?,?,?)',code,'draft',1,JSON.stringify(document),now(),due);
          return send(201,{code});
        }
      }
      const assignmentExport=path.match(/^\/api\/admin\/assignments\/(HW-[A-F0-9]{8})\/export\.csv$/);
      if(assignmentExport&&method==='GET') {
        const [code]=assignmentExport.slice(1);
        const assignment=one('SELECT document,due_at FROM assignments WHERE code=?',code);
        check(assignment,'Работа не найдена',404);
        const document=JSON.parse(assignment.document);
        const title=document.title;
        const prompts=questions(document).map(question=>({type:question.type,prompt:question.prompt}));
        const rows=db.prepare('SELECT submissions.id,users.name,submissions.created_at,submissions.due_at,submissions.score,submissions.max_score,submissions.feedback,submissions.answers,submissions.marks FROM submissions JOIN users ON users.id=submissions.user_id WHERE submissions.code=? ORDER BY submissions.id').iterate(code);
        const header=['assignment_code','assignment_title','submission_id','student_name','submitted_at','current_due_at','due_at_when_submitted','late','score','max_score','feedback','question_prompts_json','answers_json','marks_json'].map(csvCell).join(',');
        res.writeHead(200,{
          'Content-Type':'text/csv; charset=utf-8',
          'Content-Disposition':`attachment; filename="${code}-submissions.csv"`,
          'Cache-Control':'no-store'
        });
        if(!await writeChunk(res,'\uFEFF'+header+'\r\n')) return;
        for(const row of rows) {
          const line=[
            code,title,row.id,row.name,row.created_at,assignment.due_at,row.due_at,
            Boolean(row.due_at&&row.created_at>row.due_at),row.score,row.max_score,row.feedback,JSON.stringify(prompts),
            JSON.stringify(JSON.parse(row.answers)),row.marks?JSON.stringify(JSON.parse(row.marks)):''
          ].map(csvCell).join(',')+'\r\n';
          if(!await writeChunk(res,line)) return;
        }
        return res.end();
      }
      const assignment=path.match(/^\/api\/(admin\/assignments|homework)\/(HW-[A-F0-9]{8})(\/submissions)?$/);
      if(assignment) {
        const [,scope,code,submissions]=assignment;
        const teacher=scope.startsWith('admin');
        const get=()=>one('SELECT * FROM assignments WHERE code=?',code);
        if(teacher&&submissions&&method==='GET') {
          check(get(),'Работа не найдена',404);
          if(requestUrl.searchParams.has('limit')) {
            const limit=Number(requestUrl.searchParams.get('limit'));
            const offset=Number(requestUrl.searchParams.get('offset')??0);
            const cursor=requestUrl.searchParams.has('cursor')?Number(requestUrl.searchParams.get('cursor')):null;
            const query=(requestUrl.searchParams.get('q')??'').trim();
            const status=requestUrl.searchParams.get('status')??'all';
            check(Number.isInteger(limit)&&limit>=1&&limit<=100,'Размер страницы должен быть от 1 до 100');
            check(Number.isInteger(offset)&&offset>=0&&offset<=10000000,'Неверное смещение страницы');
            check(query.length<=100,'Поисковый запрос слишком длинный');
            check(['all','pending','reviewed'].includes(status),'Неверный фильтр проверки');
            const filters=['code=?'];
            const values=[code];
            if(status==='pending') filters.push('submissions.score IS NULL');
            if(status==='reviewed') filters.push('submissions.score IS NOT NULL');
            if(query) { filters.push('instr(unicode_lower(name),unicode_lower(?))>0'); values.push(query); }
            const where=' WHERE '+filters.join(' AND ');
            const total=one('SELECT COUNT(*) AS total FROM submissions JOIN users ON users.id=user_id'+where,...values).total;
            if(cursor!==null) {
              check(Number.isSafeInteger(cursor)&&cursor>=1,'Неверный курсор страницы');
              filters.push('submissions.id<?'); values.push(cursor);
            }
            const pageWhere=' WHERE '+filters.join(' AND ');
            const rows=all('SELECT submissions.*,name FROM submissions JOIN users ON users.id=user_id'+pageWhere+' ORDER BY submissions.id DESC LIMIT ? OFFSET ?',...values,limit+1,offset);
            const hasMore=rows.length>limit;
            const items=rows.slice(0,limit);
            return send(200,{items:items.map(submission),total,nextOffset:hasMore?offset+limit:null,
              nextCursor:hasMore?items.at(-1).id:null});
          }
          return send(200,all('SELECT submissions.*,name FROM submissions JOIN users ON users.id=user_id WHERE code=? ORDER BY submissions.id DESC',code).map(submission));
        }
        if(teacher&&!submissions&&method==='GET') {
          const a=get();
          check(a,'Работа не найдена',404);
          return send(200,{code,status:a.status,revision:a.revision,createdAt:a.created_at,dueAt:a.due_at,document:JSON.parse(a.document)});
        }
        if(teacher&&!submissions&&method==='PUT') {
          const body=await json(req,8*1024*1024);
          const a=get();
          check(a,'Работа не найдена',404);
          const status=body.status??a.status;
          check(['draft','published','archived'].includes(status),'Неверный статус');
          const document=body.document===undefined?a.document:JSON.stringify(validateDocument(body.document));
          const dueAt=body.dueAt===undefined?a.due_at:normalizedDueAt(body.dueAt);
          sql('UPDATE assignments SET document=?,status=?,due_at=?,revision=revision+? WHERE code=?',document,status,dueAt,Number(document!==a.document||status!==a.status),code);
          return send(200,{code,status});
        }
        if(!teacher&&!submissions&&method==='GET') {
          const a=get();
          check(a?.status==='published','Работа не найдена или закрыта',404);
          return send(200,{code,revision:a.revision,dueAt:a.due_at,document:studentDocument(JSON.parse(a.document),code,a.revision)});
        }
        if(!teacher&&submissions&&method==='POST') {
          const {name,answers,attemptId,revision}=await json(req,10*1024*1024);
          check(typeof name==='string'&&name.trim().length>=2&&name.trim().length<=100,'Введи имя (2–100 символов)');
          check(typeof attemptId==='string'&&/^[a-zA-Z0-9_-]{24,128}$/.test(attemptId),'Неверный идентификатор попытки');
          const previous=one('SELECT token FROM submissions WHERE code=? AND attempt=?',code,attemptId);
          if(previous) return send(200,previous);
          const a=get();
          check(a?.status==='published','Работа не найдена или закрыта',404);
          check(a.revision===revision,'Работа изменилась. Открой её заново.',409);
          const document=JSON.parse(a.document);
          validateAnswers(document,answers);
          const storedAnswers=persistAudioAnswers(answers,mediaDir);
          const resultToken=token();
          db.exec('BEGIN IMMEDIATE');
          try {
            const user=sql("INSERT INTO users(role,name) VALUES('student',?)",name.trim()).lastInsertRowid;
            sql('INSERT INTO submissions(code,user_id,attempt,token,document,answers,created_at,due_at) VALUES(?,?,?,?,?,?,?,?)',code,user,attemptId,resultToken,JSON.stringify(studentDocument(document,code,revision,true)),JSON.stringify(storedAnswers),now(),a.due_at);
            db.exec('COMMIT');
          } catch(error) { db.exec('ROLLBACK'); throw error; }
          return send(201,{token:resultToken});
        }
      }
      const grade=path.match(/^\/api\/admin\/submissions\/(\d+)$/);
      if(grade&&method==='PATCH') {
        let {score,maxScore,feedback,marks}=await json(req);
        const row=one('SELECT document FROM submissions WHERE id=?',grade[1]);
        check(row,'Ответ не найден',404);
        if(marks!==undefined) {
          marks=validateMarks(JSON.parse(row.document),marks);
          score=marks.reduce((total,mark)=>total+mark.score,0);
          maxScore=marks.reduce((total,mark)=>total+mark.maxScore,0);
        }
        check(Number.isFinite(score)&&Number.isFinite(maxScore)&&score>=0&&maxScore>0&&maxScore<=100000&&score<=maxScore,'Проверь баллы');
        check(typeof feedback==='string'&&feedback.length<=6000,'Комментарий до 6000 символов');
        check(sql('UPDATE submissions SET score=?,max_score=?,feedback=?,marks=? WHERE id=?',score,maxScore,feedback,marks===undefined?null:JSON.stringify(marks),grade[1]).changes,'Ответ не найден',404);
        return send(200,{ok:true});
      }
      const result=path.match(/^\/api\/results\/([\w-]{32})$/);
      if(result&&method==='GET') {
        const row=one('SELECT submissions.*,name FROM submissions JOIN users ON users.id=user_id WHERE token=?',result[1]);
        check(row,'Результат не найден',404);
        const document=JSON.parse(row.document);
        const answers=JSON.parse(row.answers);
        const marks=row.marks?JSON.parse(row.marks):[];
        const exercises=questions(document).map((q,i)=>({prompt:q.prompt,type:q.type,answer:answers[i],mark:marks[i]??null,
          ...(q.type==='match'?{matchLeft:q.matchLeft,matchRight:q.matchRight}:{})}));
        return send(200,{title:document.title,name:row.name,score:row.score,maxScore:row.max_score,feedback:row.feedback,createdAt:row.created_at,dueAt:row.due_at,late:Boolean(row.due_at&&row.created_at>row.due_at),exercises});
      }
      if(method==='GET'&&path==='/homework.schema.json') return send(200,schema);
      if(method==='GET'&&path==='/homework.example.json') return send(200,example);
      const media=path.match(/^\/media\/([a-f0-9]{64}\.(png|jpg|webp|gif|mp3|mp4|webm|ogg|wav))$/);
      if(media&&(method==='GET'||method==='HEAD')) {
        const file=resolve(mediaDir,media[1]);
        const stats=statSync(file,{throwIfNoEntry:false});
        check(stats?.isFile(),'Медиа не найдено',404);
        const size=stats.size;
        const range=req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
        let start=0,end=size-1;
        if(range) {
          if(range[1]) { start=Number(range[1]); if(range[2]) end=Math.min(end,Number(range[2])); }
          else if(range[2]) start=Math.max(0,size-Number(range[2]));
        }
        if(req.headers.range&&(!range||(!range[1]&&!range[2])||start>end)) {
          res.writeHead(416,{'Content-Range':`bytes */${size}`});return res.end();
        }
        res.writeHead(range?206:200,{'Content-Type':mime[media[2]],'Accept-Ranges':'bytes','Content-Length':end-start+1,'Cache-Control':'public, max-age=31536000, immutable',...(range?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});
        if(method==='HEAD') return res.end();
        const stream=createReadStream(file,{start,end});
        res.on('close',()=>stream.destroy());
        stream.on('error',()=>res.destroy());
        return stream.pipe(res);
      }
      const assets={'/main.js':'text/javascript','/student.js':'text/javascript','/admin.js':'text/javascript','/style.css':'text/css','/portrait.png':'image/png'};
      if(method==='GET'&&(Object.hasOwn(assets,path)||/^\/(?:about|student|admin|h\/[\w-]+|result\/[\w-]+)?\/?$/.test(path))) {
        const type=assets[path]||'text/html';
        const file=readFileSync(resolve(publicDir,type==='text/html'?'index.html':path.slice(1)));
        res.writeHead(200,{'Content-Type':type+(type.startsWith('text/')?'; charset=utf-8':''),'Cache-Control':'no-cache'});
        return res.end(file);
      }
      return send(404,{error:'Страница не найдена'});
    } catch(error) {
      if(!error.status) console.error(error);
      if(!res.headersSent) send(error.status||500,{error:error.status?error.message:'Ошибка сервера'});
      else res.destroy();
    }
  });
  server.on('close',()=>db.close());
  return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.PORT||8080);
  const server=createApp().listen(port,'0.0.0.0',()=>console.log('Lina’s Homeworks on port '+port));
  for(const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>server.close());
}
