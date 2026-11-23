import {createServer} from 'node:http';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,statSync,createReadStream} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDatabase} from './storage/database.js';
import {check,schema,example,validateDocument,validateAnswers} from './document.js';

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../web');
const digest = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(24).toString('base64url');
const sessionAge = 8 * 3600;
const mime = {png:'image/png',jpg:'image/jpeg',webp:'image/webp',gif:'image/gif',mp3:'audio/mpeg',mp4:'video/mp4'};
const mimeExtensions = Object.fromEntries(Object.entries(mime).map(([ext,type])=>[type,ext]));
const hashOrder = (code, revision, index, slot) => digest([code,revision,index,slot].join(':'));
function studentDocument(document,code,revision,review=false) {
  let index=0;
  return {...document,sections:document.sections.map(s=>({...s,questions:s.questions.map(q=>{
    const questionIndex=index++;
    if(q.type!=='match') return q;
    const order=q.pairs.map((_,i)=>i).sort((a,b)=>hashOrder(code,revision,questionIndex,a).localeCompare(hashOrder(code,revision,questionIndex,b)));
    if(order.every((i,j)=>i===j)) order.push(order.shift());
    return {...q,pairs:review?q.pairs:[],matchLeft:q.pairs.map(p=>p.left),matchRight:order.map(i=>q.pairs[i].right)};
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
async function json(req) {
  check(req.headers['content-type']?.split(';')[0]==='application/json','Ожидается JSON',415);
  const bytes=await readBody(req,1024*1024);
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
export function createApp({dataDir=process.env.DATA_DIR||'./data',password=process.env.ADMIN_PASSWORD,secure=process.env.COOKIE_SECURE!=='0'}={}) {
  if(typeof password!=='string'||password.length<12) throw new Error('Set ADMIN_PASSWORD to at least 12 characters.');
  const mediaDir=resolve(dataDir,'media');
  mkdirSync(mediaDir,{recursive:true});
  const db=openDatabase(dataDir);
  const sql=(query,...params)=>db.prepare(query).run(...params);
  const one=(query,...params)=>db.prepare(query).get(...params);
  const all=(query,...params)=>db.prepare(query).all(...params);
  const now=()=>new Date().toISOString();
  const passwordHash=Buffer.from(digest(password),'hex');
  const cookie=(res,value,age)=>res.setHeader('Set-Cookie',`lina_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure?'; Secure':''}`);
  let loginWindow=0, failureCount=0;
  function submission(row) {
    const {id,name,score,max_score:maxScore,feedback,created_at:createdAt}=row;
    return {id,name,score,maxScore,feedback,createdAt,document:JSON.parse(row.document),answers:JSON.parse(row.answers)};
  }
  const server=createServer(async (req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; media-src 'self' https:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const send=(status,data)=>{
      res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      res.end(JSON.stringify(data));
    };
    try {
      const path=new URL(req.url,'http://local').pathname;
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
        if(Date.now()-loginWindow>60000) { loginWindow=Date.now(); failureCount=0; }
        check(failureCount<12,'Слишком много попыток. Попробуй через минуту.',429);
        const body=await json(req);
        if(typeof body.password!=='string'||!timingSafeEqual(Buffer.from(digest(body.password),'hex'),passwordHash)) {
          failureCount++; return send(401,{error:'Неверный пароль'});
        }
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
        if(method==='GET') return send(200,all('SELECT * FROM assignments ORDER BY created_at DESC').map(a=>({...a,document:JSON.parse(a.document)})));
        if(method==='POST') {
          const {document}=await json(req);
          validateDocument(document);
          let code;
          do { code='HW-'+randomBytes(4).toString('hex').toUpperCase(); } while(one('SELECT 1 FROM assignments WHERE code=?',code));
          sql('INSERT INTO assignments VALUES(?,?,?,?,?)',code,'draft',1,JSON.stringify(document),now());
          return send(201,{code});
        }
      }
      const assignment=path.match(/^\/api\/(admin\/assignments|homework)\/(HW-[A-F0-9]{8})(\/submissions)?$/);
      if(assignment) {
        const [,scope,code,submissions]=assignment;
        const teacher=scope.startsWith('admin');
        const get=()=>one('SELECT * FROM assignments WHERE code=?',code);
        if(teacher&&submissions&&method==='GET') {
          check(get(),'Работа не найдена',404);
          return send(200,all('SELECT submissions.*,name FROM submissions JOIN users ON users.id=user_id WHERE code=? ORDER BY submissions.id DESC',code).map(submission));
        }
        if(teacher&&!submissions&&method==='PUT') {
          const body=await json(req);
          const a=get();
          check(a,'Работа не найдена',404);
          const status=body.status??a.status;
          check(['draft','published','archived'].includes(status),'Неверный статус');
          const document=body.document===undefined?a.document:JSON.stringify(validateDocument(body.document));
          sql('UPDATE assignments SET document=?,status=?,revision=revision+? WHERE code=?',document,status,Number(document!==a.document||status!==a.status),code);
          return send(200,{code,status});
        }
        if(!teacher&&!submissions&&method==='GET') {
          const a=get();
          check(a?.status==='published','Работа не найдена или закрыта',404);
          return send(200,{code,revision:a.revision,document:studentDocument(JSON.parse(a.document),code,a.revision)});
        }
        if(!teacher&&submissions&&method==='POST') {
          const {name,answers,attemptId,revision}=await json(req);
          check(typeof name==='string'&&name.trim().length>=2&&name.trim().length<=100,'Введи имя (2–100 символов)');
          check(typeof attemptId==='string'&&/^[a-zA-Z0-9_-]{24,128}$/.test(attemptId),'Неверный идентификатор попытки');
          const previous=one('SELECT token FROM submissions WHERE code=? AND attempt=?',code,attemptId);
          if(previous) return send(200,previous);
          const a=get();
          check(a?.status==='published','Работа не найдена или закрыта',404);
          check(a.revision===revision,'Работа изменилась. Открой её заново.',409);
          const document=JSON.parse(a.document);
          validateAnswers(document,answers);
          const resultToken=token();
          db.exec('BEGIN IMMEDIATE');
          try {
            const user=sql("INSERT INTO users(role,name) VALUES('student',?)",name.trim()).lastInsertRowid;
            sql('INSERT INTO submissions(code,user_id,attempt,token,document,answers,created_at) VALUES(?,?,?,?,?,?,?)',code,user,attemptId,resultToken,JSON.stringify(studentDocument(document,code,revision,true)),JSON.stringify(answers),now());
            db.exec('COMMIT');
          } catch(error) { db.exec('ROLLBACK'); throw error; }
          return send(201,{token:resultToken});
        }
      }
      const grade=path.match(/^\/api\/admin\/submissions\/(\d+)$/);
      if(grade&&method==='PATCH') {
        const {score,maxScore,feedback}=await json(req);
        check(Number.isFinite(score)&&Number.isFinite(maxScore)&&score>=0&&maxScore>0&&maxScore<=100000&&score<=maxScore,'Проверь баллы');
        check(typeof feedback==='string'&&feedback.length<=6000,'Комментарий до 6000 символов');
        check(sql('UPDATE submissions SET score=?,max_score=?,feedback=? WHERE id=?',score,maxScore,feedback,grade[1]).changes,'Ответ не найден',404);
        return send(200,{ok:true});
      }
      const result=path.match(/^\/api\/results\/([\w-]{32})$/);
      if(result&&method==='GET') {
        const row=one('SELECT submissions.*,name FROM submissions JOIN users ON users.id=user_id WHERE token=?',result[1]);
        check(row,'Результат не найден',404);
        return send(200,{title:JSON.parse(row.document).title,name:row.name,score:row.score,maxScore:row.max_score,feedback:row.feedback,createdAt:row.created_at});
      }
      if(method==='GET'&&path==='/homework.schema.json') return send(200,schema);
      if(method==='GET'&&path==='/homework.example.json') return send(200,example);
      const media=path.match(/^\/media\/([a-f0-9]{64}\.(png|jpg|webp|gif|mp3|mp4))$/);
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
