import {readdirSync,statSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

const mediaDir='/app/data/media';
const db=new DatabaseSync('/app/data/homework.sqlite',{readOnly:true});
const referenced=new Set();
const mediaPath=/\/media\/([a-f0-9]{64}\.(?:png|jpg|webp|gif|mp3|mp4|webm|ogg|wav))/g;

function collect(value) {
  if(typeof value!=='string') return;
  for(const match of value.matchAll(mediaPath)) referenced.add(match[1]);
}

for(const table of ['assignments','submissions']) {
  for(const row of db.prepare(`SELECT document FROM ${table}`).iterate()) collect(row.document);
}
for(const row of db.prepare('SELECT answers FROM submissions').iterate()) collect(row.answers);
db.close();

const files=readdirSync(mediaDir).filter(name=>/^[a-f0-9]{64}\.(?:png|jpg|webp|gif|mp3|mp4|webm|ogg|wav)$/.test(name))
  .map(name=>({name,size:statSync(`${mediaDir}/${name}`).size}));
const used=files.filter(file=>referenced.has(file.name));
const unreferenced=files.filter(file=>!referenced.has(file.name));
const size=items=>items.reduce((total,file)=>total+file.size,0);
const format=bytes=>`${(bytes/1024/1024).toFixed(2)} MiB`;

console.log(`Media files: ${files.length} · ${format(size(files))}`);
console.log(`Referenced by saved assignments/submissions: ${used.length} · ${format(size(used))}`);
console.log(`Not referenced by the database: ${unreferenced.length} · ${format(size(unreferenced))}`);
if(unreferenced.length) {
  console.log('Unreferenced files (review manually; a local unsaved draft may still use one):');
  for(const file of unreferenced) console.log(`  ${file.name} · ${format(file.size)}`);
}
