const root=document.querySelector('#app');
const path=location.pathname.replace(/\/$/,'')||'/';
export async function api(path,{method='GET',body}={}) {
  const response=await fetch(path,{method,...(body!==undefined?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  const data=await response.json();
  if(!response.ok) throw new Error(data.error||'Не удалось выполнить запрос');
  return data;
}
function mount(name) {
  root.replaceChildren(document.querySelector('#'+name+'-template').content.cloneNode(true));
  root.firstElementChild.classList.add('show');
}
function portraitEffect() {
  const photo=root.querySelector('.about-photo');
  const portrait=photo.querySelector('img');
  photo.style.setProperty('--portrait-mask','url("/portrait.png")');
  for(const color of ['green','pink','cream']) {
    const layer=document.createElement('span');
    layer.className='portrait-silhouette silhouette-'+color;
    layer.setAttribute('aria-hidden','true');
    photo.insertBefore(layer,portrait);
  }
  portrait.addEventListener('pointerenter',()=>photo.classList.add('portrait-active'));
  portrait.addEventListener('pointerleave',()=>photo.classList.remove('portrait-active'));
}
function revealCards() {
  const cards=root.querySelector('.cards');
  if(!('IntersectionObserver' in window)) return;
  cards.classList.add('reveal-on-scroll');
  const observer=new IntersectionObserver(entries=>{
    if(entries.some(entry=>entry.isIntersecting)) {
      cards.classList.add('is-visible');
      observer.disconnect();
    }
  },{threshold:.1});
  observer.observe(cards);
}
let stripeFrame;
function stripes() {
  if(stripeFrame) return;
  stripeFrame=requestAnimationFrame(()=>{
    stripeFrame=undefined;
    document.documentElement.style.setProperty('--top-stripe-shift',window.scrollY*.32+'px');
    document.documentElement.style.setProperty('--bottom-stripe-shift',-window.scrollY*.22+'px');
  });
}
window.addEventListener('scroll',stripes,{passive:true});
stripes();
const active=path.startsWith('/h/')||path.startsWith('/result/')?'/student':path;
document.querySelectorAll('.nav a').forEach(a=>{
  if(a.getAttribute('href')===active) a.setAttribute('aria-current','page');
});
try {
  if(path==='/') {
    mount('home');
    revealCards();
    document.querySelector('#footer-note').hidden=false;
  } else if(path==='/about') {
    mount('about');
    portraitEffect();
  } else if(path==='/admin') {
    root.classList.add('admin-view');
    const {admin}=await import('/admin.js');
    await admin(root,api);
  } else {
    const {student,result}=await import('/student.js');
    if(path.startsWith('/result/')) await result(root,api,path.split('/').at(-1));
    else await student(root,api,path.startsWith('/h/')?path.split('/').at(-1):null);
  }
} catch(error) {
  const panel=document.createElement('section');
  panel.className='panel';
  panel.textContent=error.message;
  const back=document.createElement('a');
  back.href='/student';
  back.textContent='Вернуться к заданиям';
  panel.append(document.createElement('br'),back);
  root.replaceChildren(panel);
}
