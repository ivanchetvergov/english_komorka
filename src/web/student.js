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
  return () => {
    const selected = controls.filter(control => control.checked).map(control => control.value);
    return multiple ? selected : (selected[0] ?? '');
  };
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
  return () => solved ? solution : '';
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
  return () => [...mapping];
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
  return () => reviewed.size ? `Reviewed ${reviewed.size}/${cards.length} cards` : '';
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
    case 'text': {
      const input = element('textarea', 'answer');
      input.rows = 2;
      input.setAttribute('aria-labelledby', heading.id);
      block.append(input);
      return () => input.value;
    }
    default:
      block.append(notice('This question type is unavailable.'));
      return () => '';
  }
}

function renderCodeEntry(panel) {
  const form = element('form');
  const { wrapper, input } = field('Homework code');
  input.autocapitalize = 'characters';
  input.autocomplete = 'off';
  input.spellcheck = false;
  const submit = button('Open homework', 'primary');
  submit.type = 'submit';
  form.append(wrapper, submit);
  panel.append(element('h2', '', 'Student homework'), form, link('Home', '/'));
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
    panel.append(element('h3', '', 'Recent results on this device'), list);
  }
}

function renderHomework(panel, api, routeCode, homework) {
  const { code = routeCode, document: assignment, revision } = homework;
  const form = element('form');
  const fields = element('fieldset');
  fields.style.border = '0';
  fields.style.padding = '0';
  fields.style.margin = '0';
  fields.style.minWidth = '0';
  const { wrapper, input } = field('Your name');
  input.autocomplete = 'name';
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
  fields.append(submit);
  form.append(fields, message);
  panel.replaceChildren(link('Back to code entry', '/student'), element('div', 'eyebrow', code),
    element('h2', '', assignment.title));
  if (assignment.description) {
    const description = element('p');
    appendFormatted(description, assignment.description);
    panel.append(description);
  }
  panel.append(form);

  let attemptId;
  input.addEventListener('input', () => input.setCustomValidity(''));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (fields.disabled) return;
    const name = input.value.trim();
    if (!name) {
      input.setCustomValidity('Enter your name.');
      input.reportValidity();
      return;
    }
    attemptId ??= Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),
      byte => byte.toString(16).padStart(2, '0')).join('');
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

export async function student(root, api, code) {
  const panel = view(root);
  if (!code) {
    renderCodeEntry(panel);
    const quotes = ['Ошибаться можно.', 'Ты справишься!', 'Шаг за шагом.', 'Каждый ответ — прогресс.', 'Пробуй, получится!'];
    const stored = 'student.quote.v1';
    let previous;
    try { previous = sessionStorage.getItem(stored); } catch {}
    const choices = quotes.filter(quote => quote !== previous);
    const quote = choices[Math.floor(Math.random() * choices.length)];
    try { sessionStorage.setItem(stored, quote); } catch {}
    const card = element('aside', 'hero-card');
    const heading = element('h2', 'student-quote', quote);
    card.append(heading, element('p', '', 'Читай задания в своём темпе. Практика для этого и нужна.'));
    const landing = element('section', 'hero student-landing workspace show');
    landing.append(panel, card);
    root.replaceChildren(landing);
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
      element('p', 'notice', score));
    if (data.createdAt != null) {
      const date = new Date(data.createdAt);
      const timestamp = element('time', '', Number.isNaN(date.getTime())
        ? data.createdAt : date.toLocaleString());
      if (!Number.isNaN(date.getTime())) timestamp.dateTime = date.toISOString();
      const submitted = element('p', '', 'Submitted ');
      submitted.append(timestamp);
      panel.append(submitted);
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
