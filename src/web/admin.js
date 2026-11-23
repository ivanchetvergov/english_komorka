import {audioPlayer,previewHomework} from './student.js';

const assignmentsPath = '/api/admin/assignments';
const maxDocumentBytes = 4 * 1024 * 1024;
const maxImportBytes = 8 * 1024 * 1024;
const questionTypes = {
  choice: 'Один вариант',
  multi: 'Несколько вариантов',
  text: 'Текстовый ответ',
  speaking: 'Speaking · устный ответ',
  hangman: 'Угадай слово',
  match: 'Сопоставление',
  flash: 'Карточки',
};
const typeFields = { choice: 'options', multi: 'options', hangman: 'solution', match: 'pairs', flash: 'cards' };
const statuses = {
  draft: 'Черновик',
  published: 'Опубликовано',
  archived: 'В архиве',
};
const faceKinds = { text: 'Текст', image: 'Изображение' };
const mediaKinds = { image: 'Изображение', audio: 'Аудио', video: 'Видео' };
const uploadTypes = {
  image: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  audio: ['audio/mpeg'],
  video: ['video/mp4'],
};

function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content !== undefined) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function button(label, onClick, className = 'secondary') {
  const node = element('button', label, className);
  node.type = 'button';
  if (onClick) node.addEventListener('click', onClick);
  else node.type = 'submit';
  return node;
}

function row(...children) {
  const node = element('div', undefined, 'row');
  node.append(...children);
  return node;
}

function actions(...children) {
  const node = element('div', undefined, 'button-row');
  node.append(...children);
  return node;
}

function field(label, control) {
  const wrapper = element('div', undefined, 'field');
  const caption = element('label');
  caption.append(element('span', label), control);
  wrapper.append(caption);
  return wrapper;
}

function inputField(label, value, update, type = 'text') {
  const control = element(type === 'textarea' ? 'textarea' : 'input');
  if (type !== 'textarea') control.type = type;
  control.value = value ?? '';
  if (update) control.addEventListener('input', () => update(control.value));
  return field(label, control);
}

function localDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function selectField(label, values, value, update) {
  const control = element('select');
  for (const [key, title] of Object.entries(values)) {
    const option = element('option', title);
    option.value = key;
    control.append(option);
  }
  control.value = value;
  control.addEventListener('change', () => update(control.value));
  return field(label, control);
}

function panel(title) {
  const node = element('section', undefined, 'panel');
  node.append(element('h2', title));
  return node;
}

function blankFace() {
  return { kind: 'text', value: '' };
}

function blankQuestion() {
  return {
    type: 'text', prompt: '', options: [], solution: '', pairs: [], cards: [], media: [],
  };
}

function blankSection() {
  return { title: '', questions: [blankQuestion()] };
}

function blankDocument() {
  return { title: '', description: '', sections: [blankSection()] };
}

function requireValue(condition, path, expectation) {
  if (!condition) throw new Error(`${path} — ${expectation}.`);
}

function string(value, path) {
  requireValue(typeof value === 'string', path, 'нужна строка');
}

function object(value, path) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), path, 'нужен объект');
}

function list(value, path, validate) {
  requireValue(Array.isArray(value), path, 'нужен массив');
  value.forEach((item, index) => validate(item, `${path}[${index}]`));
}

function face(value, path) {
  object(value, path);
  requireValue(typeof value.kind === 'string' && Object.hasOwn(faceKinds, value.kind), `${path}.kind`, 'нужно text или image');
  string(value.value, `${path}.value`);
}

function validateDocument(document) {
  object(document, '$');
  string(document.title, 'title');
  string(document.description, 'description');
  list(document.sections, 'sections', (section, sectionPath) => {
    object(section, sectionPath);
    string(section.title, `${sectionPath}.title`);
    list(section.questions, `${sectionPath}.questions`, (question, path) => {
      object(question, path);
      requireValue(typeof question.type === 'string' && Object.hasOwn(questionTypes, question.type),
        `${path}.type`, 'неизвестный тип задания');
      string(question.prompt, `${path}.prompt`);
      string(question.solution, `${path}.solution`);
      if (question.type === 'hangman') {
        requireValue(question.solution.trim(), `${path}.solution`, 'укажите слово для угадывания');
      }
      list(question.options, `${path}.options`, string);
      if (question.acceptedAnswers!==undefined) list(question.acceptedAnswers, `${path}.acceptedAnswers`, string);
      list(question.pairs, `${path}.pairs`, (pair, pairPath) => {
        object(pair, pairPath);
        face(pair.left, `${pairPath}.left`);
        face(pair.right, `${pairPath}.right`);
      });
      list(question.cards, `${path}.cards`, (card, cardPath) => {
        object(card, cardPath);
        face(card.front, `${cardPath}.front`);
        face(card.back, `${cardPath}.back`);
      });
      list(question.media, `${path}.media`, (media, mediaPath) => {
        object(media, mediaPath);
        requireValue(typeof media.kind === 'string' && Object.hasOwn(mediaKinds, media.kind),
          `${mediaPath}.kind`, 'нужно image, audio или video');
        string(media.url, `${mediaPath}.url`);
      });
    });
  });
  requireValue(new TextEncoder().encode(JSON.stringify(document)).byteLength <= maxDocumentBytes,
    '$', 'размер задания не должен превышать 4 МиБ');
  return document;
}

function parseDocument(text) {
  requireValue(new TextEncoder().encode(text).byteLength <= maxImportBytes,
    'JSON', 'файл не должен превышать 8 МиБ');
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`Ошибка в JSON. ${error.message}`);
  }
  return validateDocument(value);
}

async function uploadMedia(file, kind) {
  if (!uploadTypes[kind].includes(file.type)) throw new Error('Формат файла не поддерживается.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Размер файла превышает 20 МиБ.');
  const response = await fetch('/api/admin/media', {
    method: 'POST',
    headers: { 'Content-Type': file.type, 'X-Upload': '1' },
    body: file,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = result?.message ?? result?.error;
    throw new Error(typeof detail === 'string' && detail ? detail : `Ошибка загрузки (HTTP ${response.status}).`);
  }
  if (typeof result?.url !== 'string' || !result.url) throw new Error('Сервер не вернул адрес файла.');
  return result.url;
}

function downloadLink(path, title) {
  const link = element('a', title);
  link.href = path;
  link.download = path.slice(1);
  return link;
}

function mediaPreview(kind, value) {
  const fallback = element('span', value || '—');
  if (typeof value !== 'string' || !value.trim()) return fallback;
  let url;
  try {
    url = new URL(value, window.location.href);
  } catch {
    return fallback;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback;
  const node = element(kind === 'image' ? 'img' : kind);
  if (kind === 'image') {
    node.alt = value;
    node.loading = 'lazy';
    node.style.maxHeight = '10rem';
  } else {
    node.controls = true;
    node.preload = 'none';
  }
  node.style.maxWidth = '100%';
  node.src = url.href;
  node.addEventListener('error', () => node.replaceWith(fallback), { once: true });
  return node;
}

function answerText(answer) {
  if (answer == null || answer === '' || (Array.isArray(answer) && !answer.length)) return 'Нет ответа';
  if (Array.isArray(answer)) return answer.map(value => value == null ? '—' : String(value)).join(', ');
  return String(answer);
}

function displayedFaces(question, side) {
  const pairs = Array.isArray(question.pairs) ? question.pairs : [];
  const displayed = side === 'left' ? question.matchLeft : question.matchRight;
  if (!Array.isArray(displayed)) return pairs.map(pair => pair?.[side]);
  return displayed.map(item => {
    if (Number.isInteger(item)) return pairs[item]?.[side];
    return item?.[side] ?? item;
  });
}

function reviewFace(value, fallback) {
  if (value?.kind === 'image') return mediaPreview('image', value.value);
  if (value?.kind === 'text' && typeof value.value === 'string') return element('span', value.value || fallback);
  return element('span', typeof value === 'string' && value ? value : fallback);
}

function renderMatching(question, answer) {
  if (answer != null && !Array.isArray(answer)) return element('p', answerText(answer));
  const selected = Array.isArray(answer) ? answer : [];
  const left = displayedFaces(question, 'left');
  const right = displayedFaces(question, 'right');
  const count = Math.max(left.length, selected.length);
  if (!count) return element('p', answerText(answer));
  const list = element('ol');
  for (let index = 0; index < count; index++) {
    const value = selected[index];
    const item = element('li');
    const chosen = Number.isInteger(value) ? right[value] : undefined;
    item.append(
      reviewFace(left[index], `Элемент ${index + 1}`),
      ' → ',
      reviewFace(chosen, value == null ? 'Нет ответа' : `Вариант ${Number.isInteger(value) ? value + 1 : value}`),
    );
    list.append(item);
  }
  return list;
}

function renderReviewAnswer(question,answer) {
  if(question.type==='match') return renderMatching(question,answer);
  if(question.type==='speaking' && typeof answer==='string'
    && (answer.startsWith('data:audio/')||answer.startsWith('/media/'))) {
    return audioPlayer(answer);
  }
  return element('p',answerText(answer),'answer-review-text');
}

function renderAnswers(submission, buildMark) {
  const result = element('div');
  const answers = Array.isArray(submission.answers) ? submission.answers : [];
  const sections = Array.isArray(submission.document?.sections) ? submission.document.sections : [];
  let index = 0;
  for (const section of sections) {
    if (!Array.isArray(section?.questions)) continue;
    if (section.title) result.append(element('h4', section.title));
    for (const question of section.questions) {
      const answer = answers[index++];
      const item=element('section',undefined,'question exercise-review');
      item.append(element('h4', `${index}. ${question.prompt || 'Задание'}`));
      if (Array.isArray(question?.media)) {
        for (const media of question.media) {
          if (media && Object.hasOwn(mediaKinds, media.kind)) item.append(mediaPreview(media.kind, media.url));
        }
      }
      item.append(renderReviewAnswer(question,answer));
      if (buildMark) item.append(buildMark(index-1));
      result.append(item);
    }
  }
  for (; index < answers.length; index++) {
    result.append(element('p', `${index + 1}. ${answerText(answers[index])}`));
  }
  if (!index) result.append(element('p', 'Ответов нет.'));
  return result;
}

export async function admin(root, api) {
  const screen = element('div');
  const notice = element('div');
  Object.assign(notice.style, {
    position: 'sticky', top: '0', zIndex: '1', padding: '0.65rem 1rem',
    background: 'var(--paper, white)', border: '1px solid currentColor',
  });
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  notice.hidden = true;
  root.replaceChildren(notice, screen);

  let busy = false;
  let assignments = [];
  let editing = null;
  let focusAfterRun = null;

  function announce(message, error = false) {
    notice.textContent = message;
    notice.hidden = !message;
    notice.setAttribute('role', error ? 'alert' : 'status');
  }

  async function run(work) {
    if (busy) return;
    const previousFocus = document.activeElement;
    busy = true;
    screen.inert = true;
    screen.setAttribute('aria-busy', 'true');
    announce('');
    try {
      await work();
    } catch (error) {
      announce(error?.message || 'Не удалось выполнить действие.', true);
    } finally {
      busy = false;
      screen.inert = false;
      screen.removeAttribute('aria-busy');
      const target=focusAfterRun;
      focusAfterRun=null;
      if(target?.isConnected) target.focus({preventScroll:true});
      else if (document.activeElement === document.body && screen.contains(previousFocus)) {
        previousFocus.focus({ preventScroll: true });
      }
    }
  }

  function login() {
    const page = panel('Вход в учительскую');
    page.classList.add('admin-login');
    page.append(element('p', 'Здесь можно создавать задания и проверять ответы.', 'help-text'));
    const form = element('form');
    const password = element('input');
    password.type = 'password';
    password.autocomplete = 'current-password';
    password.required = true;
    password.placeholder = 'Введите пароль';
    form.className = 'student-entry';
    form.append(field('Пароль', password), button('Войти', null, 'primary'));
    form.addEventListener('submit', event => {
      event.preventDefault();
      void run(async () => {
        await api('/api/login', { method: 'POST', body: { password: password.value } });
        dashboard();
        await refresh();
      });
    });
    page.append(form);
    screen.replaceChildren(page);
  }

  const assignmentList = element('div', undefined, 'assignment-list');
  const assignmentFilters = element('div', undefined, 'row admin-filters');
  const assignmentSearch = element('input');
  assignmentSearch.type = 'search';
  assignmentSearch.placeholder = 'Название или код';
  assignmentSearch.setAttribute('aria-label', 'Найти работу по названию или коду');
  const assignmentStatus = selectField('Статус', { all: 'Все статусы', ...statuses }, 'all', scheduleAssignmentRefresh);
  assignmentFilters.append(field('Поиск работ', assignmentSearch), assignmentStatus);
  assignmentSearch.addEventListener('input', scheduleAssignmentRefresh);
  const editorSlot = element('div');
  const reviewSlot = element('div');
  let assignmentTotal = 0;
  let assignmentNextCursor = null;
  let assignmentRequest = 0;
  let assignmentSearchTimer;

  function dashboard() {
    const page = panel('Учительская');
    const newAssignment = button('Новая работа', () => void run(() => openEditor()), 'primary');
    const reload = button('Обновить список', () => run(refresh), 'secondary button-quiet');
    const logout = button('Выйти', () => {
      if (!canLeaveEditor()) return;
      void run(async () => {
        await api('/api/logout', { method: 'POST', body: {} });
        editing = null;
        assignments = [];
        assignmentList.replaceChildren();
        editorSlot.replaceChildren();
        reviewSlot.replaceChildren();
        login();
      });
    });
    page.append(actions(newAssignment, reload, logout), element('h3', 'Работы'), assignmentFilters, assignmentList);
    screen.replaceChildren(page, editorSlot, reviewSlot);
  }

  function scheduleAssignmentRefresh() {
    clearTimeout(assignmentSearchTimer);
    assignmentSearchTimer = setTimeout(() => {
      void refresh().catch(error => announce(error?.message || 'Не удалось загрузить работы.', true));
    }, 250);
  }

  async function refresh({ append = false } = {}) {
    const request = ++assignmentRequest;
    const params = new URLSearchParams({
      limit: '25',
      q: assignmentSearch.value.trim(),
      status: assignmentStatus.querySelector('select').value,
    });
    if (append && assignmentNextCursor) params.set('cursor', assignmentNextCursor);
    const page = await api(`${assignmentsPath}?${params}`, { method: 'GET' });
    if (request !== assignmentRequest) return;
    if (append) {
      const existing = new Set(assignments.map(assignment => assignment.code));
      assignments.push(...page.items.filter(assignment => !existing.has(assignment.code)));
    } else assignments = page.items;
    assignmentTotal = page.total;
    assignmentNextCursor = page.nextCursor;
    renderAssignments();
  }

  function renderAssignments() {
    assignmentList.replaceChildren();
    const query = assignmentSearch.value.trim().toLocaleLowerCase('ru');
    const status = assignmentStatus.querySelector('select').value;
    const visible = assignments.filter(assignment => {
      const title = assignment.title || 'Без названия';
      return (status === 'all' || assignment.status === status)
        && (!query || `${title} ${assignment.code}`.toLocaleLowerCase('ru').includes(query));
    });
    if (!assignmentTotal && !query && status === 'all') {
      assignmentList.append(element('p', 'Работ пока нет. Нажмите «Новая работа», чтобы создать первую.', 'notice'));
    } else if (!visible.length) {
      assignmentList.append(element('p', 'По заданным условиям работ не найдено.', 'notice'));
    } else {
      assignmentList.append(element('p', `Показано ${visible.length} из ${assignmentTotal} работ.`, 'help-text'));
    }
    for (const assignment of visible) {
      const item = element('div', undefined, 'assignment');
      const summary = element('div');
      const badge = element('span', statuses[assignment.status] ?? assignment.status, 'assignment-status');
      badge.dataset.status = assignment.status;
      const submissionCount=Number(assignment.submission_count??0);
      const pendingCount=Number(assignment.pending_count??0);
      const lateCount=Number(assignment.late_count??0);
      const dueDate=assignment.due_at?new Date(assignment.due_at):null;
      const dueLabel=dueDate&&Number.isFinite(dueDate.getTime())
        ? ` · Срок: ${dueDate.toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'})}` : '';
      const lateLabel=lateCount?` · с опозданием: ${lateCount}`:'';
      const progress=submissionCount
        ? `Сдано: ${submissionCount} · ждут проверки: ${pendingCount}${lateLabel}${dueLabel}`
        : `Сдач пока нет${dueLabel}`;
      summary.append(element('strong', assignment.title || 'Без названия'),
        element('small', assignment.code), ' ', element('small', progress), ' ', badge);
      const controls = actions(
        button('Редактировать', () => void run(() => openEditor(assignment))),
        button('Сдачи', () => run(() => openReview(assignment))),
        button('Посмотреть как ученик', () => void run(async () => {
          const detail = assignment.document ? assignment : await api(`${assignmentsPath}/${encodeURIComponent(assignment.code)}`, { method: 'GET' });
          showPreview(detail.document);
        })),
        button('Дублировать', () => run(async () => {
          if (!canLeaveEditor()) return;
          const detail = assignment.document ? assignment : await api(`${assignmentsPath}/${encodeURIComponent(assignment.code)}`, { method: 'GET' });
          const document=structuredClone(detail.document);
          document.title=('Копия · '+document.title).slice(0,140);
          const {code}=await api(assignmentsPath,{method:'POST',body:{document}});
          editing=null;
          await refresh();
          await openEditor({code,status:'draft',document});
          announce('Создан новый черновик.');
        })),
      );
      if (assignment.status === 'published') {
        controls.append(button('Скопировать ссылку', () => run(() => copyLink(assignment.code))));
      }
      item.append(summary, controls);
      assignmentList.append(item);
    }
    if (assignmentNextCursor !== null) {
      assignmentList.append(button('Показать ещё работы', () => void run(() => refresh({ append: true }))));
    }
  }

  function showPreview(document) {
    const dialog=element('dialog',undefined,'preview-dialog');
    const body=element('section',undefined,'panel');
    const close=button('Закрыть предпросмотр',()=>dialog.close());
    dialog.append(close,body);
    dialog.addEventListener('close',()=>{
      for (const control of body.querySelectorAll('.speaking-control')) control.dispatchEvent(new Event('previewclose'));
      dialog.remove();
    },{once:true});
    previewHomework(body,document);
    root.append(dialog);
    dialog.showModal();
    close.focus();
  }

  async function copyLink(code) {
    const url = new URL(`/h/${encodeURIComponent(code)}`, window.location.href);
    try {
      await navigator.clipboard.writeText(url.href);
      announce('Ссылка скопирована.');
    } catch {
      const control = element('input');
      control.type = 'text';
      control.readOnly = true;
      control.value = url.href;
      announce('Скопируйте ссылку для ученика.');
      notice.append(field('Ссылка для ученика', control));
      control.focus();
      control.select();
    }
  }

  function canLeaveEditor() {
    return !editing?.dirty || window.confirm('Закрыть редактор без сохранения изменений?');
  }

  window.addEventListener('beforeunload', event => {
    if (!editing?.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  async function openEditor(assignment) {
    if (assignment && editing?.code === assignment.code) return;
    if (!canLeaveEditor()) return;
    if (assignment && !assignment.document) {
      const detail = await api(`${assignmentsPath}/${encodeURIComponent(assignment.code)}`, { method: 'GET' });
      assignment = { ...assignment, ...detail };
    }
    editing = {
      code: assignment?.code,
      status: assignment?.status ?? 'draft',
      document: assignment ? structuredClone(assignment.document) : blankDocument(),
      savedDocument: assignment?.document,
      dueAt: assignment?.dueAt ?? null,
      mode: 'manual',
      dirty: false,
    };
    renderEditor();
  }

  function renderEditor() {
    const state = editing;
    const inactiveFields = new WeakMap();
    const page = panel(state.code ? `Работа ${state.code}` : 'Новая работа');
    const status = element('p');
    const body = element('div');
    const footer = element('div');
    const importFile = element('input');
    importFile.type = 'file';
    importFile.accept = '.json,application/json';
    const mode = button('', () => {
      if (state.mode === 'manual') {
        state.mode = 'json';
        state.json = JSON.stringify(state.document, null, 2);
      } else {
        try {
          state.document = parseDocument(state.json);
        } catch (error) {
          announce(error.message, true);
          return;
        }
        state.mode = 'manual';
      }
      announce('');
      renderBody();
    });
    importFile.addEventListener('change', () => {
      const file = importFile.files[0];
      importFile.value = '';
      if (!file) return;
      if (file.size > maxImportBytes) {
        announce('JSON-файл не должен превышать 8 МиБ.', true);
        return;
      }
      void run(async () => {
        const imported = parseDocument(await file.text());
        const text = JSON.stringify(imported, null, 2);
        const current = state.mode === 'json' ? state.json : JSON.stringify(state.document, null, 2);
        if (state.dirty && current !== text && !window.confirm('Заменить несохранённые изменения содержимым файла?')) return;
        state.document = imported;
        state.json = text;
        state.dirty = true;
        renderBody();
        announce('JSON загружен в редактор.');
      });
    });

    function renderBody() {
      mode.textContent = state.mode === 'manual' ? 'Редактировать JSON' : 'Открыть визуальный редактор';
      const dueInput=element('input');
      dueInput.type='datetime-local';
      dueInput.value=localDateTime(state.dueAt);
      dueInput.addEventListener('input',()=>{
        state.dueAt=dueInput.value?new Date(dueInput.value).toISOString():null;
        state.dirty=true;
      });
      const dueField=field('Срок сдачи · необязательно',dueInput);
      dueField.append(element('p','Время указывается по часовому поясу браузера. Поздние ответы принимаются и помечаются для преподавателя.','help-text'));
      if (state.mode === 'json') {
        const json = inputField('JSON задания', state.json, value => {
          state.json = value;
          state.dirty = true;
        }, 'textarea');
        const textarea = json.querySelector('textarea');
        textarea.classList.add('json-editor');
        textarea.rows = 18;
        textarea.spellcheck = false;
        body.replaceChildren(dueField,json);
      } else {
        body.replaceChildren(
          dueField,
          editorInput('Название', state.document, 'title'),
          editorInput('Описание', state.document, 'description', 'textarea'),
          element('p', 'В описании и формулировках заданий можно использовать **жирный текст**, *курсив* и переносы строк.'),
          collection('Разделы', state.document.sections, 'раздел', blankSection, sectionFields),
        );
      }
    }

    function renderFooter() {
      status.textContent = statuses[state.status];
      status.classList.add('assignment-status');
      status.dataset.status = state.status;
      const controls = [button('Сохранить', () => run(() => save()), 'primary'),
        button('Посмотреть как ученик', () => {
          try { showPreview(state.mode==='json'?parseDocument(state.json):validateDocument(state.document)); }
          catch (error) { announce(error.message,true); }
        })];
      if (state.status !== 'published') {
        controls.push(button('Опубликовать', () => run(() => save('published'))));
      } else {
        controls.push(button('Скопировать ссылку', () => run(() => copyLink(state.code))));
      }
      if (state.code && state.status !== 'archived') {
        controls.push(button('В архив', () => run(() => save('archived'))));
      }
      footer.replaceChildren(actions(...controls));
    }

    async function save(statusChange) {
      const archive = statusChange === 'archived';
      const document = archive ? null : state.mode === 'json'
        ? parseDocument(state.json)
        : validateDocument(state.document);
      const payload = archive ? {} : { document,dueAt:state.dueAt };
      if (statusChange) payload.status = statusChange;
      if (!state.code) {
        const created = await api(assignmentsPath, { method: 'POST', body: { document,dueAt:state.dueAt } });
        state.code = created.code;
        state.document = document;
        state.savedDocument = structuredClone(document);
        state.dirty = false;
        page.querySelector('h2').textContent = `Работа ${state.code}`;
        upsertAssignment();
        renderFooter();
        if (statusChange) {
          try {
            await api(`${assignmentsPath}/${encodeURIComponent(state.code)}`, {
              method: 'PUT', body: { status: statusChange },
            });
          } catch (error) {
            throw new Error(`Черновик ${state.code} сохранён. Публикация не удалась. ${error.message}`);
          }
        }
      } else {
        await api(`${assignmentsPath}/${encodeURIComponent(state.code)}`, { method: 'PUT', body: payload });
      }
      if (!archive) {
        state.document = document;
        state.savedDocument = structuredClone(document);
        state.dirty = false;
      }
      if (statusChange) state.status = statusChange;
      upsertAssignment();
      renderFooter();
      announce(archive ? 'Работа перемещена в архив.' : statusChange ? 'Работа опубликована.' : 'Работа сохранена.');
    }

    function upsertAssignment() {
      void refresh().catch(error => announce(error?.message || 'Работа сохранена, но список обновить не удалось.', true));
    }

    function editorInput(label, target, key, type) {
      return inputField(label, target[key], value => {
        target[key] = value;
        state.dirty = true;
      }, type);
    }

    function collection(title, items, noun, create, render) {
      const group = element('fieldset', undefined, 'editor-group');
      const list = element('div');
      function addItem(item, index) {
        const entry = element('div', undefined, 'editor-entry');
        const remove = button('Удалить', () => {
          items.splice(index, 1);
          state.dirty = true;
          redraw();
          const remaining = list.querySelectorAll('button.button-remove');
          (remaining[Math.min(index, remaining.length - 1)] ?? add).focus();
        });
        remove.classList.add('button-remove');
        remove.setAttribute('aria-label', `Удалить ${noun} №${index + 1}`);
        entry.append(...render(item, index), remove);
        list.append(entry);
        return entry;
      }
      function redraw() {
        list.replaceChildren();
        items.forEach(addItem);
      }
      const add = button(`Добавить ${noun}`, () => {
        const item = create();
        items.push(item);
        state.dirty = true;
        addItem(item, items.length - 1).querySelector('input, textarea, select, button')?.focus();
      });
      group.append(element('legend', title), list, add);
      redraw();
      return group;
    }

    function sectionFields(section, index) {
      return [
        editorInput(`Название раздела ${index + 1}`, section, 'title'),
        collection('Задания', section.questions, 'задание', blankQuestion, questionFields),
      ];
    }

    function questionFields(question, index) {
      const specific = element('div');
      function renderSpecific() {
        specific.replaceChildren();
        if (['choice','multi','text'].includes(question.type)) {
          const key=inputField('Ключ автопроверки', (question.acceptedAnswers??[]).join('\n'), value => {
            question.acceptedAnswers=value.split('\n').map(line=>line.trim()).filter(Boolean);
            state.dirty=true;
          },'textarea');
          const hint = question.type==='text' ? 'Один допустимый ответ на строку. Пусто — ручная проверка.'
            : question.type==='multi' ? 'Перечислите все правильные варианты, по одному на строку. Пусто — ручная проверка.'
            : 'Введите точный текст правильного варианта. Пусто — ручная проверка.';
          key.append(element('p',hint,'help-text'));
          specific.append(key);
        }
        if (question.type==='speaking') specific.append(element('p','Ученик сможет записать до 60 секунд, прослушать ответ и перезаписать его.','help-text'));
        switch (question.type) {
          case 'choice':
          case 'multi':
            specific.append(collection('Варианты ответа', question.options, 'вариант', () => '',
              (option, position) => [inputField(`Вариант ${position + 1}`, option, value => {
                question.options[position] = value;
                state.dirty = true;
              })]));
            break;
          case 'hangman':
            specific.append(editorInput('Слово для угадывания', question, 'solution'));
            break;
          case 'match':
            specific.append(element('p', 'Добавьте хотя бы две пары. В каждой паре нужны текст и изображение.'),
              collection('Пары', question.pairs, 'пару',
              () => ({ left: blankFace(), right: { kind: 'image', value: '' } }),
              (pair, position) => [row(
                faceFields(`Пара ${position + 1} · слева`, pair.left),
                faceFields(`Пара ${position + 1} · справа`, pair.right),
              )]));
            break;
          case 'flash':
            specific.append(collection('Карточки', question.cards, 'карточку',
              () => ({ front: blankFace(), back: blankFace() }),
              (card, position) => [row(
                faceFields(`Карточка ${position + 1} · лицевая сторона`, card.front),
                faceFields(`Карточка ${position + 1} · оборот`, card.back),
              )]));
            break;
        }
      }
      renderSpecific();
      return [
        selectField(`Тип задания ${index + 1}`, questionTypes, question.type, type => {
          const previous = typeFields[question.type];
          const next = typeFields[type];
          if (previous !== next) {
            const saved = inactiveFields.get(question) ?? {};
            if (previous) {
              saved[previous] = question[previous];
              question[previous] = previous === 'solution' ? '' : [];
            }
            if (next && Object.hasOwn(saved, next)) question[next] = saved[next];
            inactiveFields.set(question, saved);
          }
          if (question.type!==type) delete question.acceptedAnswers;
          question.type = type;
          state.dirty = true;
          renderSpecific();
        }),
        editorInput(`Формулировка задания ${index + 1}`, question, 'prompt', 'textarea'),
        specific,
        collection('Медиа', question.media, 'медиафайл', () => ({ kind: 'image', url: '' }), mediaFields),
      ];
    }

    function assetFields(label, target, kinds, key) {
      const group = element('div');
      const valueSlot = element('div');
      function renderValue() {
        const kind = target.kind;
        const url = editorInput(kind === 'text' ? 'Текст' : 'URL файла', target, key);
        valueSlot.replaceChildren(url);
        if (kind === 'text') return;
        const picker = element('input');
        picker.type = 'file';
        picker.accept = uploadTypes[kind].join(',');
        picker.addEventListener('change', () => {
          const file = picker.files[0];
          picker.value = '';
          if (!file) return;
          void run(async () => {
            const uploaded = await uploadMedia(file, kind);
            target[key] = uploaded;
            url.querySelector('input').value = uploaded;
            state.dirty = true;
            announce('Файл загружен.');
          });
        });
        valueSlot.append(field('Загрузить файл · до 20 МиБ', picker));
      }
      group.append(selectField(label, kinds, target.kind, kind => {
        target.kind = kind;
        state.dirty = true;
        renderValue();
      }), valueSlot);
      renderValue();
      return group;
    }

    function faceFields(label, target) {
      return assetFields(label, target, faceKinds, 'value');
    }

    function mediaFields(target, index) {
      return [assetFields(`Тип медиафайла ${index + 1}`, target, mediaKinds, 'url')];
    }

    page.append(
      status,
      actions(mode, downloadLink('/homework.schema.json', 'Скачать схему'),
        downloadLink('/homework.example.json', 'Скачать шаблон'), button('Закрыть редактор', () => {
          if (!canLeaveEditor()) return;
          editing = null;
          editorSlot.replaceChildren();
        })),
      field('Импортировать JSON', importFile),
      body,
      footer,
    );
    renderBody();
    renderFooter();
    editorSlot.replaceChildren(page);
    page.scrollIntoView({ block: 'start' });
  }

  async function openReview(assignment) {
    const endpoint = `${assignmentsPath}/${encodeURIComponent(assignment.code)}/submissions`;
    const page = panel(`Сдачи · ${assignment.title || assignment.document?.title || assignment.code}`);
    const search = element('input');
    search.type = 'search';
    search.placeholder = 'Имя ученика';
    search.setAttribute('aria-label', 'Найти сдачу по имени ученика');
    const list = element('div', undefined, 'submission-list');
    let submissions = [];
    let total = 0;
    let nextCursor = null;
    let requestId = 0;
    let searchTimer;
    let filter;
    function render() {
      list.replaceChildren();
      list.append(element('p', `Показано ${submissions.length} из ${total} сдач.`, 'help-text'));
      if (!submissions.length) {
        const filtered = search.value.trim() || filter.querySelector('select').value !== 'all';
        list.append(element('p', total || filtered ? 'По заданным условиям сдач не найдено.' : 'Сдач пока нет.', 'notice'));
      }
      for (const submission of submissions) list.append(submissionCard(submission, (changed, card) => {
        const state = filter.querySelector('select').value;
        if (state !== 'all' && (state === 'reviewed') !== (changed.score !== null)) {
          submissions = submissions.filter(item => item.id !== changed.id);
          total = Math.max(0, total - 1);
          card.remove();
          focusAfterRun=list.querySelector('.submission-card summary') ?? search;
          if(list.firstElementChild) list.firstElementChild.textContent=`Показано ${submissions.length} из ${total} сдач.`;
          if(!submissions.length&&!list.querySelector('.notice')) {
            const message=nextCursor===null
              ? (total?'По заданным условиям сдач не найдено.':'Все сдачи проверены.')
              : 'Показанные сдачи проверены. Можно загрузить следующие.';
            const note=element('p',message,'notice');
            const more=[...list.querySelectorAll('button')].find(control=>control.textContent==='Показать ещё сдачи');
            list.insertBefore(note,more??null);
          }
        } else {
          const summary = card.querySelector('.score-summary');
          if(summary) summary.textContent=`Опубликовано: ${changed.score} / ${changed.maxScore}`;
        }
      }));
      if (nextCursor !== null) {
        list.append(button('Показать ещё сдачи', () => void loadPage(true)));
      }
    }
    async function loadPage(append = false) {
      const request = ++requestId;
      const params = new URLSearchParams({
        limit: '10',
        q: search.value.trim(),
        status: filter.querySelector('select').value,
      });
      if (append && nextCursor !== null) params.set('cursor', String(nextCursor));
      try {
        const result = await api(`${endpoint}?${params}`, { method: 'GET' });
        if (request !== requestId) return;
        if (append) {
          const existing = new Set(submissions.map(submission => submission.id));
          submissions.push(...result.items.filter(submission => !existing.has(submission.id)));
        } else submissions = result.items;
        if (!append) total = result.total;
        nextCursor = result.nextCursor;
        render();
      } catch (error) {
        if (request === requestId) announce(error?.message || 'Не удалось загрузить сдачи.', true);
      }
    }
    filter = selectField('Проверка', { all: 'Все сдачи', pending: 'Ожидают проверки', reviewed: 'Проверены' }, 'all', () => void loadPage());
    const filters = row(field('Поиск по имени', search), filter);
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => void loadPage(), 250);
    });
    page.append(actions(button('Обновить сдачи', () => run(() => openReview(assignment))),
      downloadLink(`/api/admin/assignments/${encodeURIComponent(assignment.code)}/export.csv`, 'Выгрузить все сдачи CSV'),
      button('Закрыть сдачи', () => reviewSlot.replaceChildren())),
      element('p', 'Выгрузка содержит все сдачи этой работы, независимо от поиска и фильтра.', 'help-text'), filters, list);
    render();
    reviewSlot.replaceChildren(page);
    page.scrollIntoView({ block: 'start' });
    await loadPage();
  }

  function submissionCard(submission, onUpdate) {
    const card = element('article', undefined, 'submission-card');
    const date = new Date(submission.createdAt);
    card.append(element('h3', submission.name || 'Без имени'));
    if (submission.createdAt && Number.isFinite(date.getTime())) {
      const time = element('time', date.toLocaleString('ru-RU'));
      time.dateTime = date.toISOString();
      card.append(time);
    }
    if(submission.late) card.append(element('p','notice','Сдано после срока.'));
    const details = element('details');
    const form=element('form');
    const controls=[];
    function markFields(index) {
      const mark=submission.marks?.[index]??submission.suggestedMarks?.[index]??{};
      const scores=row(inputField('Баллы',mark.score,null,'number'),
        inputField('Максимум баллов',mark.maxScore??1,null,'number'));
      const [score,max]=scores.querySelectorAll('input');
      for(const input of [score,max]) {
        input.min='0';
        input.max='1000';
        input.step='any';
        input.required=true;
      }
      const comment=inputField('Комментарий к заданию',mark.feedback,null,'textarea');
      const feedback=comment.querySelector('textarea');
      feedback.maxLength=900;
      const hints={
        article:'Проверь, нужен ли здесь артикль a/an или the.',
        tense:'Проверь, какое время подходит по контексту.',
        spelling:'Проверь написание этого слова.',
      };
      const preset=selectField('Быстрая подсказка',{'':'Выберите подсказку',article:'Артикль',tense:'Время глагола',spelling:'Правописание'},'',key=>{
        if (!hints[key]) return;
        const next=[feedback.value,hints[key]].filter(Boolean).join('\n');
        if (next.length<=feedback.maxLength) feedback.value=next;
        preset.querySelector('select').value='';
      });
      const fields=element('div');
      if(!submission.marks && mark.automatic) fields.append(element('p','Баллы предложены автоматически.','help-text'));
      fields.append(scores,comment,preset);
      controls.push({score,max,feedback});
      return fields;
    }
    details.append(element('summary','Открыть ответы и проверку'),renderAnswers(submission,markFields));
    const general=inputField('Общий комментарий',submission.feedback,null,'textarea');
    const feedback=general.querySelector('textarea');
    feedback.maxLength=6000;
    if(submission.score!==null) card.append(element('p',`Опубликовано: ${submission.score} / ${submission.maxScore}`,'score-summary'));
    details.append(general,button('Опубликовать оценку',null,'primary'));
    form.append(details);
    form.addEventListener('submit',event=>{
      event.preventDefault();
      void run(async()=>{
        const marks=controls.map(({score,max,feedback})=>({score:score.valueAsNumber,maxScore:max.valueAsNumber,feedback:feedback.value}));
        if (marks.some(mark=>!Number.isFinite(mark.score)||!(mark.maxScore>0)||mark.score<0||mark.score>mark.maxScore)) {
          throw new Error('Заполните баллы по всем заданиям. Балл должен быть от нуля до максимума.');
        }
        await api(`/api/admin/submissions/${encodeURIComponent(submission.id)}`,{
          method:'PATCH',body:{marks,feedback:feedback.value},
        });
        const score=marks.reduce((total,mark)=>total+mark.score,0);
        const max=marks.reduce((total,mark)=>total+mark.maxScore,0);
        submission.marks=marks;
        submission.score=score;
        submission.maxScore=max;
        submission.feedback=feedback.value;
        onUpdate?.(submission,card);
        await refresh();
        announce(`Оценка опубликована · ${submission.name || 'Без имени'}.`);
      });
    });
    card.append(form);
    return card;
  }

  async function checkSession() {
    const retry = panel('Учительская');
    retry.append(button('Повторить проверку входа', () => run(checkSession)));
    screen.replaceChildren(retry);
    const session = await api('/api/session', { method: 'GET' });
    if (!session.admin) {
      login();
      return;
    }
    dashboard();
    await refresh();
  }

  await run(checkSession);
}
