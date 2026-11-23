const types = ['choice','multi','text','hangman','match','flash','speaking'];
const maxDocumentBytes = 4 * 1024 * 1024;
export function check(ok, message, status = 400) {
  if (!ok) throw Object.assign(new Error(message), {status});
}
const str = (max, nonempty = false) => ({type:'string', maxLength:max, ...(nonempty ? {minLength:1} : {})});
const enumOf = (...values) => ({type:'string',enum:values});
const list = (items,maxItems,minItems=0) => ({type:'array',items,maxItems,minItems});
const obj = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const side = obj({kind:enumOf('text','image'),value:str(2000,true)});
export const schema = {
  $schema:'https://json-schema.org/draft/2020-12/schema',
  description:'Serialized homework JSON must not exceed 4 MiB.',
  title:'Lina’s Homeworks', ...obj({
    title:str(140,true),description:str(4000),
    sections:list(obj({title:str(140,true),questions:list(obj({
      type:enumOf(...types),prompt:str(4000,true),options:list(str(300,true),20),
      solution:str(120),pairs:list(obj({left:side,right:side}),20),
      cards:list(obj({front:side,back:side}),30),
      acceptedAnswers:list(str(300,true),20),
      media:list(obj({kind:enumOf('image','audio','video'),url:str(2000,true)}),5)
    }),30,1)}),12,1)
  })
};
const questionSchema=schema.properties.sections.items.properties.questions.items;
questionSchema.required=questionSchema.required.filter(key=>key!=='acceptedAnswers');
const normalize = value => value.normalize('NFC').trim().replace(/\s+/g,' ').replace(/[’‘]/g,"'").toLowerCase();
function validate(value, rule, path) {
  if (value===undefined && path.endsWith('.acceptedAnswers')) return;
  const valid = (ok, message) => check(ok, path + ' · ' + message);
  if (rule.type === 'string') {
    valid(typeof value === 'string','ожидается строка');
    valid(value.length <= rule.maxLength || rule.maxLength === undefined,'слишком длинный текст');
    valid(!rule.minLength || value.trim().length >= rule.minLength,'заполни поле');
    valid(!rule.enum || rule.enum.includes(value),'неизвестное значение');
  } else if (rule.type === 'array') {
    valid(Array.isArray(value) && value.length >= rule.minItems && value.length <= rule.maxItems,'неверное число элементов');
    value.forEach((item,i) => validate(item,rule.items,path+'.'+(i+1)));
  } else {
    valid(value && typeof value === 'object' && !Array.isArray(value),'ожидается объект');
    valid(Object.keys(value).every(k => Object.hasOwn(rule.properties,k)),'неизвестное поле');
    for (const key of new Set([...rule.required,...Object.keys(value)])) validate(value[key],rule.properties[key],path+'.'+key);
  }
}
function mediaURL(value) {
  if (/^\/media\/[a-f0-9]{64}\.(png|jpg|webp|gif|mp3|mp4)$/.test(value)) return;
  const url = URL.canParse(value) && new URL(value);
  check(url && url.protocol === 'https:' && !url.username && !url.password,'Для медиа нужна прямая HTTPS-ссылка');
}
export const questions = doc => doc.sections.flatMap(s=>s.questions);
export function validateDocument(doc) {
  validate(doc,schema,'Homework');
  check(Buffer.byteLength(JSON.stringify(doc),'utf8')<=maxDocumentBytes,'Размер задания не должен превышать 4 МиБ');
  check(questions(doc).length<=100,'До 100 вопросов на работу');
  check(questions(doc).filter(q=>q.type==='speaking').length<=8,'До восьми устных заданий на работу');
  for (const q of questions(doc)) {
    const {type,options,pairs,cards,solution,prompt} = q;
    const require = (ok,msg) => check(ok,prompt.slice(0,60)+' · '+msg);
    require(['choice','multi'].includes(type) ? options.length>=2 && new Set(options).size===options.length : !options.length,'проверь список вариантов');
    const key=q.acceptedAnswers??[];
    require(!key.length || (['choice','multi','text'].includes(type)
      && new Set(type==='text'?key.map(normalize):key).size===key.length
      && (type==='text'||key.every(answer=>options.includes(answer)))
      && (type!=='choice'||key.length===1)), 'проверь ключ автоматической проверки');
    require(type==='hangman' ? /^[a-z][a-z '-]{0,79}$/i.test(solution.trim()) : !solution,'укажи английское слово или фразу только для виселицы');
    require(type==='match' ? pairs.length>=2 : !pairs.length,'для сопоставления нужны хотя бы две пары');
    require(type==='flash' ? cards.length>=1 : !cards.length,'для флеш-карт нужна хотя бы одна карточка');
    for (const p of pairs) require(p.left.kind!==p.right.kind,'в паре должны быть картинка и текст');
    for (const media of q.media) mediaURL(media.url);
    for (const item of [...pairs,...cards]) for (const face of Object.values(item)) if(face.kind==='image') mediaURL(face.value);
  }
  return doc;
}
export function validateAnswers(doc, answers) {
  const qs=questions(doc);
  check(Array.isArray(answers) && answers.length===qs.length,'Неверное число ответов');
  qs.forEach((q,i)=>{
    const a=answers[i];
    let valid;
    switch(q.type) {
      case 'choice': valid=a==='' || q.options.includes(a); break;
      case 'multi': valid=Array.isArray(a) && a.length<=q.options.length && new Set(a).size===a.length && a.every(x=>q.options.includes(x)); break;
      case 'match': valid=Array.isArray(a) && a.length===q.pairs.length && a.every(x=>x===null || Number.isInteger(x)&&x>=0&&x<q.pairs.length) && new Set(a.filter(x=>x!==null)).size===a.filter(x=>x!==null).length; break;
      case 'speaking': valid=a===''||validAudio(a); break;
      default: valid=typeof a==='string' && a.length<=6000;
    }
    check(valid,'Неверный формат ответа №'+(i+1));
  });
}
function validAudio(value) {
  if (typeof value!=='string'||value.length>1024*1024+64) return false;
  const match=value.match(/^data:audio\/(webm|ogg|mp4|mpeg|wav);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match||match[2].length%4) return false;
  const b=Buffer.from(match[2].slice(0,24),'base64');
  switch(match[1]) {
    case 'webm': return b.subarray(0,4).toString('hex')==='1a45dfa3';
    case 'ogg': return b.toString('ascii',0,4)==='OggS';
    case 'mp4': return b.toString('ascii',4,8)==='ftyp';
    case 'wav': return b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WAVE';
    case 'mpeg': return b.toString('ascii',0,3)==='ID3'||(b[0]===255&&(b[1]&224)===224);
  }
}

export function suggestMarks(doc,answers) {
  return questions(doc).map((q,i)=>{
    const key=q.acceptedAnswers??[];
    const answer=answers[i];
    let score=null;
    if (key.length) {
      if(q.type==='text') score=Number(key.some(value=>normalize(value)===normalize(answer)));
      if(q.type==='choice') score=Number(answer===key[0]);
      if(q.type==='multi') score=Number(answer.length===key.length&&key.every(value=>answer.includes(value)));
    }
    return {score,maxScore:1,feedback:'',automatic:score!==null};
  });
}

export function validateMarks(doc, marks) {
  check(Array.isArray(marks)&&marks.length===questions(doc).length,'Нужна оценка по каждому заданию');
  return marks.map(mark=>{
    check(mark&&Number.isFinite(mark.score)&&Number.isFinite(mark.maxScore)
      &&mark.score>=0&&mark.maxScore>0&&mark.maxScore<=1000&&mark.score<=mark.maxScore,'Проверь баллы задания');
    check(typeof mark.feedback==='string'&&mark.feedback.length<=900,'До 900 символов комментария на задание');
    return {score:mark.score,maxScore:mark.maxScore,feedback:mark.feedback};
  });
}

export const example = {title:'My homework',description:'Read each prompt carefully.',sections:[{title:'Vocabulary',questions:[{type:'choice',prompt:'Choose the word for «книга».',options:['book','pen','desk'],solution:'',pairs:[],cards:[],media:[]}]}]};
