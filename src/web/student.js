const recentResultsKey = 'student.recent-results.v1';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function appendFormatted(target, value) {
  const lines = String(value ?? '').split(/\r\n?|\n/);
  lines.forEach((line, index) => {
    if (index) target.append(element('br'));
    const emphasis = /\*\*(.+?)\*\*|(?<!\*)\*([^*]+)\*(?!\*)|(?<!\w)_([^_]+)_(?!\w)/g;
    let offset = 0;
    for (const match of line.matchAll(emphasis)) {
      target.append(line.slice(offset, match.index),
        element(match[1] === undefined ? 'em' : 'strong', '', match[1] ?? match[2] ?? match[3]));
      offset = match.index + match[0].length;
    }
    target.append(line.slice(offset));
  });
}

function button(text, className) {
  const control = element('button', className, text);
  control.type = 'button';
  return control;
}

function link(text, href, className = 'secondary') {
  const anchor = element('a', className, text);
  anchor.href = href;
  return anchor;
}

function resultLink(text, token, className) {
  return link(text, `/result/${encodeURIComponent(token)}`, className);
}

function recentResults() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(recentResultsKey) ?? '[]');
    if (Array.isArray(saved)) {
      return saved.filter(item => typeof item?.title === 'string'
        && typeof item.token === 'string' && item.token && item.token !== '.' && item.token !== '..')
        .slice(0, 10);
    }
  } catch {
    // Recent results are optional when browser storage is unavailable.
  }
  return [];
}

function rememberResult(title, token) {
  try {
    const previous = recentResults().filter(item => item.token !== token);
    window.localStorage.setItem(recentResultsKey, JSON.stringify([{ title, token }, ...previous].slice(0, 10)));
  } catch {
    // The result link is still shown in the submission receipt.
  }
}

function notice(text = '', role = 'status') {
  const message = element('p', 'notice', text);
  message.setAttribute('role', role);
  message.hidden = !text;
  return message;
}

function showNotice(message, text) {
  message.hidden = !text;
  message.textContent = text;
}

export function audioPlayer(source) {
  const wrap=element('div','audio-answer');
  const player=element('audio');
  const state=element('span','audio-state','Loading audio…');
  player.controls=true;
  player.preload='metadata';
  player.src=source;
  player.addEventListener('loadedmetadata',()=>showNotice(state,'Audio ready · press play'));
  player.addEventListener('waiting',()=>showNotice(state,'Loading audio…'));
  player.addEventListener('playing',()=>showNotice(state,'Playing'));
  player.addEventListener('pause',()=>{if(player.currentTime>0&&!player.ended)showNotice(state,'Paused')});
  player.addEventListener('ended',()=>showNotice(state,'Finished'));
  player.addEventListener('error',()=>showNotice(state,'Audio could not be played. Try downloading it or opening it in another browser.'));
  wrap.append(player,state);
  if(source.startsWith('/media/')) {
    const download=element('a','audio-download','Download recording');
    download.href=source;
    download.download='voice-answer'+(source.match(/\.(webm|ogg|mp3|mp4|wav)$/)?.[0]??'.audio');
    wrap.append(download);
  }
  player.load();
  return wrap;
}

function errorMessage(error, fallback) {
  return typeof error?.message === 'string' && error.message ? error.message : fallback;
}

function view(root) {
  const container = element('div', 'student-view');
  const panel = element('section', 'panel');
  container.append(panel);
  root.replaceChildren(container);
  return panel;
}

function field(labelText) {
  const wrapper = element('div', 'field');
  const label = element('label', '', labelText);
  const input = element('input');
  input.type = 'text';
  input.required = true;
  label.append(input);
  wrapper.append(label);
  return { wrapper, input };
}

function mediaUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    if (value.startsWith('/media/')) {
      const url = new URL(value, window.location.origin);
      const path = decodeURIComponent(url.pathname);
      if (url.origin === window.location.origin && path.startsWith('/media/')
        && !/[\\%\u0000-\u001f\u007f]/.test(path)
        && !path.split('/').some(part => part === '.' || part === '..')) {
        return url.href;
      }
      return null;
    }
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function mediaElement(kind, value, description) {
  const url = mediaUrl(value);
  if (!url) return null;
  if (kind === 'image') {
    const image = element('img');
    image.src = url;
    image.alt = description;
    image.loading = 'lazy';
    image.style.maxWidth = '100%';
    return image;
  }
  if (kind === 'audio' || kind === 'video') {
    const player = element(kind);
    player.src = url;
    player.controls = true;
    player.preload = 'none';
    player.style.maxWidth = '100%';
    player.setAttribute('aria-label', description);
    return player;
  }
  return null;
}

function sideContent(side, description) {
  if (side?.kind === 'image') {
    return mediaElement('image', side.value, description)
      ?? element('span', '', 'Image unavailable');
  }
  return element('span', '', side?.value ?? '');
}

function optionsControl(question, target, number) {
  const multiple = question.type === 'multi';
  const controls = (question.options ?? []).map(option => {
    const label = element('label', 'check');
    const control = element('input');
    control.type = multiple ? 'checkbox' : 'radio';
    control.name = `question-${number}`;
    control.value = option;
    label.append(control, element('span', '', option));
    target.append(label);
    return control;
  });
  const read = () => {
    const selected = controls.filter(control => control.checked).map(control => control.value);
    return multiple ? selected : (selected[0] ?? '');
  };
  read.restore = value => {
    for (const control of controls) control.checked = multiple
      ? Array.isArray(value) && value.includes(control.value) : value === control.value;
  };
  return read;
}

function hangmanControl(question, target) {
  const game = element('div', 'hangman-game');
  target.append(game);
  const solution = question.solution?.trim();
  if (!solution) {
    game.append(notice('This word game is unavailable.'));
    return () => '';
  }

  const letters = Array.from(solution.normalize('NFC'));
  const letterPattern = /^\p{L}$/u;
  const wordLetters = new Set(letters.filter(letter => letterPattern.test(letter))
    .map(letter => letter.toUpperCase()));
  const guesses = new Set();
  const maxWrong = 6;
  let wrong = 0;
  let solved = false;
  const mask = element('p', 'hangman-mask');
  const status = element('p', 'hangman-status');
  status.setAttribute('role', 'status');
  const keyboard = element('div', 'hangman-letters');
  const { wrapper, input } = field('Guess a letter');
  input.required = false;
  input.autocomplete = 'off';
  const guessButton = button('Guess', 'secondary');
  wrapper.append(guessButton);
  game.append(mask, status, keyboard, wrapper);

  function render() {
    solved = [...wordLetters].every(letter => guesses.has(letter));
    const finished = solved || wrong === maxWrong;
    mask.textContent = letters.map(letter => (
      finished || !letterPattern.test(letter) || guesses.has(letter.toUpperCase()) ? letter : '_'
    )).join(' ');
    status.textContent = solved ? 'You got it!'
      : finished ? `The word was ${solution}.` : `${maxWrong - wrong} wrong guesses left.`;
    for (const key of keyboard.children) key.disabled = finished || guesses.has(key.textContent);
    input.disabled = guessButton.disabled = finished;
  }

  function guess(value) {
    const letter = value.trim().normalize('NFC');
    if (solved || wrong === maxWrong) return;
    if (!letterPattern.test(letter)) {
      status.textContent = 'Enter one letter.';
      return;
    }
    const upper = letter.toUpperCase();
    if (guesses.has(upper)) {
      status.textContent = `You already guessed ${letter}.`;
      return;
    }
    guesses.add(upper);
    if (!wordLetters.has(upper)) wrong++;
    render();
  }

  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const key = button(letter, 'small-btn hangman-key');
    key.addEventListener('click', () => guess(letter));
    keyboard.append(key);
  }
  const guessTyped = () => {
    guess(input.value);
    input.value = '';
    if (!input.disabled) input.focus();
  };
  guessButton.addEventListener('click', guessTyped);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      guessTyped();
    }
  });
  render();
  const read = () => solved ? solution : '';
  read.snapshot = () => [...guesses];
  read.restore = value => { if (Array.isArray(value)) value.forEach(letter => typeof letter==='string' && guess(letter)); };
  return read;
}

function matchControl(question, target) {
  const left = question.matchLeft ?? [];
  const right = question.matchRight ?? [];
  const mapping = left.map(() => null);
  if (!left.length || !right.length) {
    target.append(notice('This matching exercise is unavailable.'));
    return () => [...mapping];
  }

  const game = element('div', 'matching-game');
  const columns = element('div', 'matching-columns');
  const leftColumn = element('div', 'matching-left');
  const rightColumn = element('div', 'matching-right');
  const status = element('p', 'matching-status');
  status.setAttribute('role', 'status');
  columns.append(leftColumn, rightColumn);
  game.append(columns, status);
  target.append(game);
  let activeLeft = null;

  function addTiles(sides, column, prefix, onClick) {
    return sides.map((side, index) => {
      const description = `${prefix} ${index + 1}`;
      const tile = button('', 'match-tile');
      const marker = element('span', '', description);
      tile.append(marker, sideContent(side, description));
      tile.addEventListener('click', () => onClick(index));
      column.append(tile);
      return { tile, marker, description };
    });
  }

  const leftTiles = addTiles(left, leftColumn, 'Left', index => {
    activeLeft = activeLeft === index ? null : index;
    render();
    if (activeLeft !== null) rightTiles[mapping[index] ?? 0].tile.focus();
  });
  const rightTiles = addTiles(right, rightColumn, 'Right', index => {
    if (activeLeft === null) return;
    const previousLeft = mapping.indexOf(index);
    if (previousLeft !== -1) mapping[previousLeft] = null;
    if (previousLeft !== activeLeft) mapping[activeLeft] = index;
    const selectedTile = leftTiles[activeLeft].tile;
    activeLeft = null;
    render();
    selectedTile.focus();
  });

  function render() {
    leftTiles.forEach(({ tile, marker, description }, index) => {
      const paired = mapping[index] !== null;
      tile.classList.toggle('selected', activeLeft === index);
      tile.classList.toggle('paired', paired);
      tile.setAttribute('aria-pressed', String(activeLeft === index));
      marker.textContent = paired ? `${description} → Right ${mapping[index] + 1}` : description;
    });
    rightTiles.forEach(({ tile, marker, description }, index) => {
      const pairedLeft = mapping.indexOf(index);
      tile.classList.toggle('paired', pairedLeft !== -1);
      tile.disabled = activeLeft === null;
      marker.textContent = pairedLeft === -1 ? description : `${description} → Left ${pairedLeft + 1}`;
    });
    const pairedCount = mapping.filter(index => index !== null).length;
    status.textContent = activeLeft === null
      ? `${pairedCount} of ${left.length} paired. Choose a left item.`
      : `Choose a right item for Left ${activeLeft + 1}. Choose its current match again to remove it.`;
  }

  render();
  const read = () => [...mapping];
  read.restore = value => {
    if (!Array.isArray(value) || value.length !== mapping.length) return;
    const used = new Set();
    value.forEach((index,i) => {
      if (Number.isInteger(index) && index >= 0 && index < right.length && !used.has(index)) {
        mapping[i] = index;
        used.add(index);
      }
    });
    render();
  };
  return read;
}

function flashControl(question, target) {
  const cards = question.cards ?? [];
  if (!cards.length) {
    target.append(notice('There are no flashcards in this exercise.'));
    return () => '';
  }

  const game = element('div', 'flash-game');
  const card = button('', 'flashcard');
  const face = element('span', 'flashcard-content');
  card.append(face);
  card.setAttribute('aria-describedby', `${target.id}-flash-action`);
  const controls = element('div', 'flash-controls');
  const previous = button('Previous', 'secondary');
  const next = button('Next', 'secondary');
  const flip = button('Show back', 'secondary');
  flip.id = `${target.id}-flash-action`;
  const count = element('span', 'flash-count');
  count.setAttribute('role', 'status');
  controls.append(previous, flip, next, count);
  game.append(card, controls);
  target.append(game);
  let index = 0;
  let back = false;
  const reviewed = new Set();

  function render() {
    const side = back ? 'Back' : 'Front';
    face.replaceChildren(sideContent(cards[index][back ? 'back' : 'front'], `${side} of card ${index + 1}`));
    flip.textContent = back ? 'Show front' : 'Show back';
    count.textContent = `${index + 1} / ${cards.length} · ${side} · ${reviewed.size} reviewed`;
    previous.disabled = index === 0;
    next.disabled = index === cards.length - 1;
  }

  function flipCard() {
    back = !back;
    if (back) reviewed.add(index);
    render();
  }

  function move(offset) {
    index += offset;
    back = false;
    render();
  }

  card.addEventListener('click', flipCard);
  flip.addEventListener('click', flipCard);
  previous.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  render();
  const read = () => reviewed.size ? `Reviewed ${reviewed.size}/${cards.length} cards` : '';
  read.snapshot = () => ({ index, back, reviewed:[...reviewed] });
  read.restore = value => {
    if (!value || !Number.isInteger(value.index) || !cards[value.index] || !Array.isArray(value.reviewed)) return;
    index = value.index;
    back = value.back === true;
    for (const cardIndex of value.reviewed) if (Number.isInteger(cardIndex) && cards[cardIndex]) reviewed.add(cardIndex);
    render();
  };
  return read;
}

function speakingControl(target) {
  const record = button('Record audio', 'primary');
  const stop = button('Stop','secondary');
  const audio = element('audio');
  const status = notice();
  const file = element('input');
  file.type = 'file';
  file.accept = 'audio/webm,audio/ogg,audio/mp4,audio/mpeg,audio/wav,audio/x-wav,.m4a';
  const label = element('label','', 'Or choose an audio file');
  label.append(file);
  const upload = element('div','field');
  upload.append(label);
  const actions = element('div','button-row');
  actions.append(record,stop);
  const remove = button('Remove audio','secondary');
  audio.controls = true;
  audio.preload = 'metadata';
  audio.addEventListener('loadedmetadata',()=>showNotice(status,'Audio ready · press play'));
  audio.addEventListener('error',()=>showNotice(status,'The audio preview failed. Try another file or browser.'));
  stop.disabled = true;
  audio.hidden = remove.hidden = true;
  const box = element('div','speaking-control');
  box.append(actions,upload,status,audio,remove);
  target.append(box);
  let value = '';
  let recorder;
  let stream;
  let timer;
  let elapsed;
  let busy = false;
  const maxBytes = 768 * 1024;
  function setAudio(next) {
    value = next;
    audio.hidden = remove.hidden = !value;
    if (value) { audio.src = value; audio.load(); }
    else { audio.removeAttribute('src'); audio.load(); }
  }
  function change() { box.dispatchEvent(new Event('draftchange',{bubbles:true})); }
  function finish() {
    clearTimeout(timer);
    clearInterval(elapsed);
    stream?.getTracks().forEach(track=>track.stop());
    stream = undefined;
    recorder = undefined;
    busy = false;
    record.disabled = file.disabled = remove.disabled = false;
    stop.disabled = true;
  }
  async function accept(blob) {
    const format = blob.type.split(';')[0].replace('audio/x-wav','audio/wav');
    if (!blob.size || blob.size > maxBytes || !/^audio\/(webm|ogg|mp4|mpeg|wav)$/.test(format)) {
      showNotice(status,'Choose a supported audio file under 768 KiB.');
      return;
    }
    const data = await new Promise((resolve,reject)=>{
      const reader = new FileReader();
      reader.onload=()=>resolve(reader.result);
      reader.onerror=()=>reject(reader.error);
      reader.readAsDataURL(blob);
    });
    setAudio(`data:${format};base64,${data.split(',')[1]}`);
    record.textContent = 'Record again';
    showNotice(status,'Audio ready. Listen before submitting.');
    change();
  }
  remove.addEventListener('click',()=>{
    setAudio('');
    record.textContent='Record audio';
    showNotice(status,'Audio removed.');
    change();
  });
  file.addEventListener('change',async ()=>{
    const blob=file.files[0];
    file.value='';
    if (!blob || busy) return;
    busy=true;
    record.disabled=file.disabled=remove.disabled=true;
    try { await accept(blob); } catch { showNotice(status,'Could not read the audio file.'); }
    finally { finish(); }
  });
  record.addEventListener('click',async ()=>{
    if (busy) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      showNotice(status,'Recording is unavailable. Choose an audio file instead.');
      return;
    }
    const mimeType=['audio/mp4','audio/webm;codecs=opus','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type));
    if (!mimeType) { showNotice(status,'Recording is unavailable. Choose an audio file instead.');return; }
    busy=true;
    record.disabled=file.disabled=remove.disabled=true;
    showNotice(status,'Waiting for microphone access…');
    try {
      stream=await navigator.mediaDevices.getUserMedia({audio:true});
      if (!box.isConnected) { finish(); return; }
      recorder=new MediaRecorder(stream,{mimeType,audioBitsPerSecond:48000});
      const recording=recorder;
      const chunks=[];
      const started=Date.now();
      recorder.addEventListener('dataavailable',event=>{ if(event.data.size)chunks.push(event.data); });
      recorder.addEventListener('stop',async ()=>{
        clearInterval(elapsed);
        clearTimeout(timer);
        stream?.getTracks().forEach(track=>track.stop());
        try { if (box.isConnected) await accept(new Blob(chunks,{type:recording.mimeType})); }
        catch { showNotice(status,'Could not prepare the recording.'); }
        finally { finish(); }
      },{once:true});
      recorder.addEventListener('error',()=>{ showNotice(status,'Could not record. Try again or choose a file.'); finish(); },{once:true});
      recorder.start();
      stop.disabled=false;
      showNotice(status,'Recording · 0 / 60 s');
      elapsed=setInterval(()=>showNotice(status,`Recording · ${Math.min(60,Math.floor((Date.now()-started)/1000))} / 60 s`),500);
      timer=setTimeout(()=>{if(recorder?.state==='recording')recorder.stop();},60000);
    } catch {
      showNotice(status,'Microphone unavailable. You can choose an audio file instead.');
      finish();
    }
  });
  stop.addEventListener('click',()=>{if(recorder?.state==='recording')recorder.stop();});
  box.addEventListener('previewclose',()=>{if(recorder?.state==='recording')recorder.stop();finish();});
  const read=()=>value;
  read.busy=()=>busy;
  read.restore=next=>{
    if (typeof next==='string' && /^data:audio\/(webm|ogg|mp4|mpeg|wav);base64,/.test(next) && next.length<=1024*1024+64) {
      setAudio(next);
      record.textContent='Record again';
    }
  };
  return read;
}

function renderQuestion(question, target, number) {
  const block = element('div', 'question');
  block.id = `student-question-${number}`;
  const heading = element('h3', '', `${number}. `);
  appendFormatted(heading, question.prompt);
  heading.id = `${block.id}-prompt`;
  block.setAttribute('role', 'group');
  block.setAttribute('aria-labelledby', heading.id);
  block.append(heading);
  const attachments = Array.isArray(question.media) ? question.media : [question.media];
  for (const media of attachments) {
    if (!media) continue;
    block.append(mediaElement(media.kind, media.url, `Attachment for question ${number}`)
      ?? notice('The attachment is unavailable.'));
  }
  target.append(block);
  switch (question.type) {
    case 'choice':
    case 'multi':
      return optionsControl(question, block, number);
    case 'hangman':
      return hangmanControl(question, block);
    case 'match':
      return matchControl(question, block);
    case 'flash':
      return flashControl(question, block);
    case 'speaking':
      return speakingControl(block);
    case 'text': {
      const input = element('textarea', 'answer');
      input.rows = 2;
      input.setAttribute('aria-labelledby', heading.id);
      block.append(input);
      input.maxLength = 6000;
      const read = () => input.value;
      read.restore = value => { if (typeof value==='string') input.value = value.slice(0,6000); };
      return read;
    }
    default:
      block.append(notice('This question type is unavailable.'));
      return () => '';
  }
}

function renderCodeEntry(panel) {
  const form = element('form', 'student-entry');
  const { wrapper, input } = field('Homework code');
  input.autocapitalize = 'characters';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = 'HW-XXXXXXXX';
  input.setAttribute('aria-describedby', 'homework-code-hint');
  const hint = element('p', 'field-hint', 'Use the code Lina sent you.');
  hint.id = 'homework-code-hint';
  wrapper.append(hint);
  const submit = button('Open homework', 'primary');
  submit.type = 'submit';
  form.append(wrapper, submit);
  panel.append(element('h2', '', 'Open your homework'), form);
  input.addEventListener('input', () => input.setCustomValidity(''));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const code = input.value.trim().toUpperCase();
    if (!code) {
      input.setCustomValidity('Enter a homework code.');
      input.reportValidity();
      return;
    }
    window.location.assign(`/h/${encodeURIComponent(code)}`);
  });
  const recent = recentResults();
  if (recent.length) {
    const list = element('ul');
    for (const { title, token } of recent) {
      const item = element('li');
      item.append(resultLink(title || 'Homework result', token, ''));
      list.append(item);
    }
    const results = element('section', 'recent-results');
    results.append(element('h3', '', 'Recent results on this device'), list);
    panel.append(results);
  }
}

function renderHomework(panel, api, routeCode, homework, preview = false) {
  const { code = routeCode, document: assignment, revision } = homework;
  const form = element('form');
  const fields = element('fieldset', 'student-fields');
  const { wrapper, input } = field('Your name');
  input.autocomplete = 'name';
  input.placeholder = 'First and last name';
  fields.append(wrapper);
  const readAnswers = [];
  for (const section of assignment.sections ?? []) {
    const group = element('section', 'student-section');
    if (section.title) group.append(element('h3', '', section.title));
    for (const question of section.questions ?? []) {
      readAnswers.push(renderQuestion(question, group, readAnswers.length + 1));
    }
    fields.append(group);
  }
  const message = notice();
  const submit = button('Submit homework', 'primary');
  submit.type = 'submit';
  if (!preview) fields.append(submit);
  form.append(fields, message);
  panel.replaceChildren();
  if (!preview) panel.append(link('Back to code entry', '/student'));
  panel.append(element('h2', '', assignment.title));
  if (code) panel.prepend(element('div', 'eyebrow', code));
  if (assignment.description) {
    const description = element('p');
    appendFormatted(description, assignment.description);
    panel.append(description);
  }
  if (assignment.dueAt) {
    const deadline = new Date(assignment.dueAt);
    if (Number.isFinite(deadline.getTime())) {
      const text = Date.now() > deadline.getTime()
        ? `Due ${deadline.toLocaleString('en-GB')} · You may still submit; your work will be marked late.`
        : `Due ${deadline.toLocaleString('en-GB')}`;
      panel.append(element('p', 'notice', text));
    }
  }
  panel.append(form);

  if (preview) {
    form.addEventListener('submit', event => event.preventDefault());
    return;
  }
  let attemptId;
  const draftKey = `student.draft.v1/${code}`;
  const draftStatus = notice();
  form.prepend(draftStatus);
  try {
    const draft = JSON.parse(localStorage.getItem(draftKey) ?? 'null');
    if (draft?.revision === revision && Array.isArray(draft.answers) && draft.answers.length === readAnswers.length) {
      input.value = typeof draft.name === 'string' ? draft.name : '';
      attemptId = typeof draft.attemptId === 'string' ? draft.attemptId : undefined;
      readAnswers.forEach((read,i) => read.restore?.(draft.answers[i]));
      showNotice(draftStatus, 'Черновик восстановлен.');
    } else if (draft) showNotice(draftStatus, 'Задание изменилось. Начни новую попытку.');
  } catch {}
  function saveDraft() {
    try {
      localStorage.setItem(draftKey, JSON.stringify({revision,name:input.value,attemptId,
        answers:readAnswers.map(read=>read.snapshot?.()??read())}));
    } catch {
      showNotice(draftStatus, 'Не удалось сохранить черновик на этом устройстве.');
      return;
    }
    showNotice(draftStatus, 'Черновик сохранён на этом устройстве.');
  }
  for (const event of ['input','click','draftchange']) form.addEventListener(event, e => {
    if (e.type!=='click' || e.target.closest('button[type="button"]')) saveDraft();
  });
  input.addEventListener('input', () => input.setCustomValidity(''));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (fields.disabled) return;
    if (readAnswers.some(read=>read.busy?.())) {
      showNotice(message,'Stop recording and wait for the audio before submitting.');
      return;
    }
    const name = input.value.trim();
    if (!name) {
      input.setCustomValidity('Enter your name.');
      input.reportValidity();
      return;
    }
    attemptId ??= Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),
      byte => byte.toString(16).padStart(2, '0')).join('');
    saveDraft();
    const body = { name, answers: readAnswers.map(read => read()), attemptId, revision };
    fields.disabled = true;
    showNotice(message, 'Submitting homework…');
    try {
      const { token } = await api(`/api/homework/${encodeURIComponent(code)}/submissions`, {
        method: 'POST',
        body
      });
      if (typeof token !== 'string' || !token || token === '.' || token === '..') {
        throw new Error('The submission did not return a result link.');
      }
      rememberResult(assignment.title, token);
      try { localStorage.removeItem(draftKey); } catch {}
      const receipt = element('section');
      receipt.append(notice('Homework submitted.'),
        resultLink('Open your personal result', token, 'primary'));
      form.replaceWith(receipt);
      receipt.querySelector('a').focus();
    } catch (error) {
      showNotice(message, errorMessage(error, 'The homework could not be submitted. Please try again.'));
      fields.disabled = false;
    }
  });
}

export function previewHomework(target, assignment) {
  const document = structuredClone(assignment);
  for (const section of document.sections) for (const q of section.questions) {
    if (q.type==='match') {
      q.matchLeft=q.pairs.map(pair=>pair.left);
      q.matchRight=q.pairs.map(pair=>pair.right).reverse();
    }
  }
  renderHomework(target, null, null, {document}, true);
}

export async function student(root, api, code) {
  const panel = view(root);
  if (!code) {
    renderCodeEntry(panel);
    const quotes = ['Ошибаться можно.', 'Ты справишься!', 'Шаг за шагом.', 'Каждый ответ — прогресс.', 'Пробуй, получится!'];
    const stored = 'student.quote.v1';
    let quote;
    try { quote = localStorage.getItem(stored); } catch {}
    if (!quotes.includes(quote)) quote = quotes[Math.floor(Math.random() * quotes.length)];
    const card = element('aside', 'hero-card');
    const heading = element('h2', 'student-quote', quote);
    heading.setAttribute('aria-live', 'polite');
    card.append(heading, element('p', '', 'Читай задания в своём темпе. Практика для этого и нужна.'));
    const landing = element('section', 'hero student-landing workspace show');
    landing.append(panel, card);
    root.replaceChildren(landing);
    let currentQuote = quote;
    window.setInterval(() => {
      const choices = quotes.filter(item => item !== currentQuote);
      const nextQuote = choices[Math.floor(Math.random() * choices.length)];
      heading.classList.add('is-changing');
      window.setTimeout(() => {
        if (!heading.isConnected) return;
        currentQuote = nextQuote;
        heading.textContent = nextQuote;
        try { localStorage.setItem(stored, nextQuote); } catch {}
        heading.classList.remove('is-changing');
      }, 220);
    }, 15000);
    return;
  }
  panel.append(link('Back to code entry', '/student'), notice('Loading homework…'));
  try {
    const homework = await api(`/api/homework/${encodeURIComponent(code)}`, { method: 'GET' });
    if (root.contains(panel)) renderHomework(panel, api, code, homework);
  } catch (error) {
    if (root.contains(panel)) {
      panel.replaceChildren(link('Back to code entry', '/student'),
        notice(errorMessage(error, 'The homework could not be opened.'), 'alert'));
    }
  }
}

function feedbackContent(value) {
  if (Array.isArray(value)) {
    const list = element('ul');
    for (const item of value) {
      const entry = element('li');
      entry.append(feedbackContent(item));
      list.append(entry);
    }
    return list;
  }
  if (value && typeof value === 'object') {
    const details = element('dl');
    for (const [label, item] of Object.entries(value)) {
      const description = element('dd');
      description.append(feedbackContent(item));
      details.append(element('dt', '', label), description);
    }
    return details;
  }
  const text = element('span', '', value ?? '');
  text.style.whiteSpace = 'pre-wrap';
  return text;
}

export async function result(root, api, token) {
  const panel = view(root);
  const back = link('Back to code entry', '/student');
  panel.append(back, notice('Loading result…'));
  try {
    const data = await api(`/api/results/${encodeURIComponent(token)}`, { method: 'GET' });
    if (!root.contains(panel)) return;
    const score = data.score == null || data.maxScore == null
      ? 'Awaiting review' : `Score: ${data.score} / ${data.maxScore}`;
    panel.replaceChildren(back, element('h2', '', data.title), element('p', '', data.name),
      element('p', 'notice score-summary', score));
    if(data.late) panel.append(notice('This homework was submitted after its due date.'));
    if (data.createdAt != null) {
      const date = new Date(data.createdAt);
      const timestamp = element('time', '', Number.isNaN(date.getTime())
        ? data.createdAt : date.toLocaleString());
      if (!Number.isNaN(date.getTime())) timestamp.dateTime = date.toISOString();
      const submitted = element('p', '', 'Submitted ');
      submitted.append(timestamp);
      panel.append(submitted);
    }
    if (Array.isArray(data.exercises) && data.exercises.length) {
      const list = element('section', 'student-section');
      list.append(element('h3','','Your answers'));
      data.exercises.forEach((exercise,i)=>{
        const item=element('article','question exercise-review');
        const title=element('h4','',`${i+1}. `);
        appendFormatted(title,exercise.prompt);
        item.append(title);
        if (exercise.type==='speaking' && typeof exercise.answer==='string'
          && (exercise.answer.startsWith('data:audio/')||exercise.answer.startsWith('/media/'))) {
          item.append(audioPlayer(exercise.answer));
        } else if (exercise.type==='match' && Array.isArray(exercise.answer)) {
          const pairs=element('ul');
          exercise.answer.forEach((index,position)=>{
            const entry=element('li');
            entry.append(sideContent(exercise.matchLeft?.[position],`Left item ${position+1}`),' → ',
              index===null?'No answer':sideContent(exercise.matchRight?.[index],`Right item ${index+1}`));
            pairs.append(entry);
          });
          item.append(pairs);
        } else {
          item.append(element('p','',Array.isArray(exercise.answer)
            ? exercise.answer.join(', ')||'No answer' : exercise.answer||'No answer'));
        }
        if(exercise.mark) {
          item.append(element('p','score-summary',`${exercise.mark.score} / ${exercise.mark.maxScore}`));
          if(exercise.mark.feedback) item.append(feedbackContent(exercise.mark.feedback));
        }
        list.append(item);
      });
      panel.append(list);
    }
    if (data.feedback != null && data.feedback !== ''
      && (!Array.isArray(data.feedback) || data.feedback.length > 0)) {
      panel.append(element('h3', '', 'Feedback'), feedbackContent(data.feedback));
    }
  } catch (error) {
    if (root.contains(panel)) {
      panel.replaceChildren(back, notice(errorMessage(error, 'The result could not be opened.'), 'alert'));
    }
  }
}
