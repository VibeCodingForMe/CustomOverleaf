# LaTeX Studio — статус задач

Обновлено: 2026-10-28. Версия приложения: **1.0.0**.

## Легенда

- `- [x] ✅` — реализовано и проверено сборкой, тестами или реальным запуском.
- `- [ ] ⚠️` — реализовано, но требует ручной/визуальной проверки либо имеет известное ограничение.
- `- [ ]` — не сделано.

> Визуальная проверка интерфейса остаётся за пользователем: macOS Screen Recording
> запрещён в этой среде, поэтому скриншоты и автоматическая проверка окна недоступны.

---

## 1. История проекта и островной визуал

Статус: реализованы проектные чекпоинты, фильтры, preview/diff, подсветка дерева,
транзакционное восстановление, настраиваемый retention, recovery перед destructive
операциями и island CSS. Legacy per-file история удалена.

### 1.1. Проектные чекпоинты

- [x] ✅ Чекпоинт хранит все файлы проекта, а не один файл.
- [x] ✅ Модель: id, имя, описание, точное время, тип (`auto`, `manual`, `pre-restore`, `pre-fix`, `pre-delete`, `pre-rename`, `pre-replace`).
- [x] ✅ Content-addressed blobs по SHA-256 без дублирования.
- [x] ✅ Исключены `.latexstudio`, `.git`, `node_modules`, `target`, `build`, `.idea`; есть лимиты размера и количества файлов.
- [x] ✅ Статусы `A`, `M`, `D`, `R` и построчный `+/-` через `similar`.
- [x] ✅ Ручной именованный чекпоинт с описанием.
- [x] ✅ Recovery-чекпоинт создаётся перед restore, fix, удалением, переименованием и replace.
- [x] ✅ Retention 10–500 в Settings, по умолчанию 80; manifests и неиспользуемые blobs очищаются.
- [x] ✅ Старые per-file snapshots и legacy-модалка удалены.

### 1.2. Панель истории

- [x] ✅ Карточки: имя/тип, дата и время, описание, affected count, `+/-`, badges `A/M/D/R`, binary count.
- [x] ✅ Реальный диапазон start/end datetime.
- [x] ✅ Today / Last 7 / Last 30 / All time.
- [x] ✅ Сортировка newest/oldest по timestamp.
- [x] ✅ Поиск по имени, описанию и типу.
- [x] ✅ Фильтр по имени затронутого файла, включая old path при rename.
- [x] ✅ Фильтр по типу изменения A/M/D/R.
- [x] ✅ Clear all, empty states, invalid-range state.
- [x] ✅ Локальные даты/время через `formatDateTime`; фильтрация только читает данные.
- [x] ✅ Toolbar History, palette и правая rail открывают одну панель.
- [ ] ⚠️ Отдельный DST-тест границ дат не добавлен; используется локальное время.

### 1.3. Restore preview

- [x] ✅ Клик по чекпоинту строит preview без записи файлов.
- [x] ✅ Diff относительно текущего проекта.
- [x] ✅ Подсветка затронутых файлов в настоящем дереве, badges и folder counts.
- [x] ✅ Клик по файлу открывает read-only diff в области редактора.
- [x] ✅ Красные удалённые и зелёные добавленные строки, нейтральный контекст.
- [x] ✅ Номера строк, маркеры `+/-`, навигация по изменениям и файлам.
- [x] ✅ Binary-файлы показываются как замена с размерами.
- [x] ✅ Баннер preview с именем, временем, read-only и Cancel.
- [x] ✅ Предупреждение о dirty buffers, token инвалидирует устаревший preview.
- [x] ✅ Cancel очищает подсветку и возвращает редактор.

### 1.4. Восстановление

- [x] ✅ Финальное подтверждение с summary.
- [x] ✅ Recovery-чекпоинт перед восстановлением и проверка token.
- [x] ✅ Additions, modifications, deletions и renames.
- [x] ✅ Полное восстановление удаляет только известные пути; untracked не трогает.
- [x] ✅ Path traversal и symlink escape проверяются.
- [x] ✅ Атомарная запись по файлам и rollback при ошибке.
- [x] ✅ Single-file и full restore.
- [x] ✅ После restore обновляются дерево, буферы, index, PDF и build state.
- [x] ✅ Успех показывается только после проверки путей; ошибка не выдаётся за успех.
- [x] ✅ Rust-тесты: preview не пишет, stale token, full restore add/modify/delete, recovery, retention.

### 1.5. Островной дизайн

- [x] ✅ Левая панель и history-панель — отдельные rounded-карточки с отступом.
- [x] ✅ Внутри: header, toolbar, дерево/список, footer.
- [x] ✅ Выделенная строка дерева — скруглённая плашка; есть badges и folder counts.
- [x] ✅ Resizers между панелями; CSS-токены для новых панелей.
- [ ] ⚠️ Финальная визуальная сверка light/dark/system, узкого окна и `ui-reference.png` нужна пользователю.

---

## 2. Layout и навигация

- [x] ✅ Три колонки: дерево, редактор, PDF.
- [x] ✅ Resizable/collapsible нижняя панель; размер и open state сохраняются.
- [x] ✅ Левая activity rail: Project / Search / Outline; правая rail истории.
- [x] ✅ Размеры sidebar, PDF и history сохраняются в localStorage.
- [x] ✅ Узкое окно: ширина панелей автоматически ограничивается, PDF остаётся рабочим.
- [x] ✅ Переключение views не сбрасывает вкладки, буферы и PDF.
- [x] ✅ Активная иконка подсвечивается; есть localized title/aria-label.
- [x] ✅ Выбранный sidebar view сохраняется.
- [ ] ⚠️ Полная ручная проверка 1040px и всех rail-подсказок остаётся.

---

## 3. Проекты и файлы

- [x] ✅ Открытие, создание, импорт, recent projects.
- [x] ✅ Дерево файлов, context menu, main file, tabs, dirty state.
- [x] ✅ Autosave, manual save, atomic writes, hash conflict detection.
- [x] ✅ External changes и EOL/BOM preservation.
- [x] ✅ Path traversal, symlink escape, protected paths.
- [x] ✅ Delete через Trash, rename, duplicate, create file/folder.
- [x] ✅ Image drag-and-drop с импортом в images/figures/assets и вставкой `\includegraphics`.
- [x] ✅ Project revision polling каждые 4 секунды обновляет дерево при внешних изменениях.
- [ ] ⚠️ Это revision poll, а не нативный FSEvents watcher.

---

## 4. Редактор

- [x] ✅ CodeMirror 6, LaTeX highlighting, line numbers, wrap, tab size, font.
- [x] ✅ Multi-tab buffers, native undo/redo, in-editor search, jump to line/column.
- [x] ✅ Gutter diagnostics из compiler + Doctor.
- [x] ✅ Snippets: section, subsection, figure, table, equation, align, matrix, lists, ref, cite, bibliography, biblatex, theorem.
- [x] ✅ Snippet autocomplete и настройка snippets.
- [x] ✅ Focus mode.
- [x] ✅ Spellcheck toggle.
- [x] ✅ Настраиваемые shortcuts с сохранением и reset.
- [x] ✅ Word count / statistics modal.
- [x] ✅ Crash recovery несохранённых буферов через localStorage.
- [ ] ⚠️ Полная keyboard-only/a11y проверка редактора остаётся.

---

## 5. Autocomplete

- [x] ✅ `\beg` → commands/environments.
- [x] ✅ `\ref{}` → labels, `\cite{}` → bib keys с metadata.
- [x] ✅ `\input{}`/`\include{}` → tex files, `\includegraphics{}` → images.
- [x] ✅ `\usepackage{}` → packages, snippets.
- [x] ✅ Live index и debounced refresh после save.
- [ ] ⚠️ Ручная проверка отсутствия дублирования `}` и больших проектов остаётся.

---

## 6. Поиск

- [x] ✅ Project content search, grouped by file, line/context, click to line.
- [x] ✅ Highlight, case sensitivity, regex, invalid-regex error.
- [x] ✅ Async/stale guard, ignore build output, Unicode.
- [x] ✅ Replace all с preview diff, подтверждением и explicit apply.
- [x] ✅ `pre-replace` recovery checkpoint, stale-token protection, atomic writes/rollback.
- [x] ✅ Literal replacement не раскрывает `$1`; regex поддерживает captures.
- [x] ✅ BOM/CRLF preservation и тесты.

---

## 7. Outline

- [x] ✅ Отдельный view, part/chapter/section/subsection/subsubsection.
- [x] ✅ Multi-file `\input`/`\include` в реальном порядке.
- [x] ✅ Collapse/expand, click to file/line, refresh.
- [x] ✅ Figures, tables и equations с caption/label.
- [ ] ⚠️ Standalone labels не вынесены в отдельную группу outline.
- [ ] ⚠️ Нет отдельного PDF TOC; outline намеренно parsed.
- [ ] ⚠️ Malformed-LaTeX сценарии покрыты частично.

---

## 8. Command Palette

- [x] ✅ `⌘K`, fuzzy filter, keyboard navigation.
- [x] ✅ Open/save/recompile/export/search/outline/history/settings.
- [x] ✅ Toggle panel/history, theme/language, stats, focus.
- [x] ✅ Snippet commands, equation builder, table builder.
- [x] ✅ Doctor и bibliography help.
- [x] ✅ EN/RU labels и динамические shortcut labels.
- [ ] ⚠️ Disabled commands не всегда объясняют причину.

---

## 9. Compilation

- [x] ✅ Tectonic, latexmk/pdflatex/xelatex/lualatex detection, auto engine.
- [x] ✅ Deterministic build dir, logs, exit code, duration, command preview.
- [x] ✅ Cancel, timeout, no concurrent builds.
- [x] ✅ Stale PDF preservation и last successful PDF.
- [x] ✅ Bundled Biber 2.17 и Latin Modern fonts.
- [x] ✅ Configurable build directory с валидацией и symlink protection.
- [x] ✅ Clean aux files отдельной командой с подтверждением.
- [x] ✅ Real Tectonic compile пользовательского проекта.
- [x] ✅ Book template реально скомпилирован Tectonic.
- [ ] ⚠️ Отдельные regression-тесты на multi-file/Unicode/space/bibliography не собраны в один suite.

---

## 10. PDF

- [x] ✅ PDF.js, continuous multi-page scroll, lazy rendering.
- [x] ✅ Current/total page, page navigation, zoom, fit width, fit page.
- [x] ✅ Text search, refresh, save/export, reveal in Finder.
- [x] ✅ Auto-refresh и stale banner.
- [x] ✅ Position сохраняется при recompile и между запусками при включённой настройке.
- [x] ✅ SyncTeX marker и Cmd+click reverse.
- [ ] ⚠️ Большие PDF и производительность не проверены отдельным stress-тестом.

---

## 11. SyncTeX

- [x] ✅ Tectonic `--synctex`; `.synctex.gz` сохраняется из того же успешного build.
- [x] ✅ Нативный gzip/plain parser без CLI `synctex`.
- [x] ✅ Forward source → page/x/y, nearest-line только внутри того же файла.
- [x] ✅ Reverse PDF click → file/line по реальным боксам.
- [x] ✅ Included files, project-relative Input mapping.
- [x] ✅ Missing/stale сообщения без угадывания.
- [x] ✅ `⌘⇧J` forward и Cmd+click reverse.
- [x] ✅ Реальный Tectonic test и пользовательский проект.
- [ ] ⚠️ Визуальная проверка маркера пользователем.

---

## 12. Project Doctor

- [x] ✅ Compiler diagnostics, severity, raw message, file/line.
- [x] ✅ Plain-language explanations, safe fix с diff/backup/confirm.
- [x] ✅ Duplicate labels, unresolved refs, citations/.bib, includes, images.
- [x] ✅ Unused images и unused `.tex` files через BFS от main file.
- [x] ✅ Circular includes, malformed LaTeX, confidence high/medium/low.
- [x] ✅ Merge compiler + static diagnostics без дублей.
- [x] ✅ Errors/Warnings/Info и переход к коду.
- [x] ✅ Health summary без произвольного балла.
- [ ] ⚠️ Overfull hbox остаётся обычным compiler warning, не отдельной категорией Doctor.
- [ ] ⚠️ Нет отдельной статической проверки missing package/tool; это ловят compiler и Settings.

---

## 13. История файловых версий

Устарело. Per-file snapshots удалены; используется единая система проектных чекпоинтов.

---

## 14. Equation builder

- [x] ✅ Дроби, степени/индексы, корни, интегралы, суммы/произведения, пределы.
- [x] ✅ Греческие буквы, операторы, скобки, вложенные конструкции.
- [x] ✅ Матрицы, aligned, системы уравнений.
- [x] ✅ Live KaTeX preview.
- [x] ✅ Вставка в cursor / замена выделения.
- [x] ✅ Редактирование поддерживаемых существующих уравнений.
- [x] ✅ Copy LaTeX, incomplete-safe.
- [x] ✅ Неподдерживаемые окружения не заменяются молча.
- [x] ✅ Подтверждение замены с before/after preview.
- [x] ✅ Тесты detection/wrapping/prose safety.

---

## 15. Table editor

- [x] ✅ Визуальная сетка и редактирование ячеек.
- [x] ✅ Добавление/удаление строк и столбцов.
- [x] ✅ Alignment l/c/r, horizontal rules (booktabs/hline/none).
- [x] ✅ Horizontal merge/unmerge.
- [x] ✅ `tabular` и `longtable`.
- [x] ✅ CSV import, generation/copy/insert, HTML preview.
- [x] ✅ Экранирование спецсимволов, Unicode, multiline.
- [x] ✅ Diff + confirm перед заменой существующей таблицы.
- [x] ✅ Неподдерживаемые окружения не разрушаются.
- [x] ✅ Тесты parse/generate/caption/longtable.

---

## 16. Export

- [x] ✅ PDF, TEX, ZIP.
- [x] ✅ Pandoc DOCX/HTML/ODT/EPUB/Markdown.
- [x] ✅ Pandoc detection, destination, overwrite confirmation, exit code/stderr.
- [x] ✅ ZIP сохраняет вложенные Unicode/space paths и исключает build output.
- [x] ✅ TEX использует выбранный main file.
- [x] ✅ Regression-тесты ZIP и TEX.
- [ ] ⚠️ Ограничения DOCX/HTML/ODT/EPUB честно описаны в UI, но не проверены на каждом шаблоне.

---

## 17. Templates и snippets

- [x] ✅ Blank, Article, Report, Thesis, Beamer, Letter, Book.
- [x] ✅ Template descriptions и licenses.
- [x] ✅ Book скомпилирован Tectonic.
- [x] ✅ Snippets: section, figure, table, equation, matrix, lists, refs, citations, bibliography, environments.
- [x] ✅ Snippet setting и autocomplete.
- [x] ✅ Проект не перезаписывается без подтверждения.

---

## 18. P1 / дополнительные функции

- [x] ✅ Word count / statistics.
- [x] ✅ Label/ref/citation navigation через index, autocomplete и palette.
- [x] ✅ BibTeX/Biber help UI.
- [x] ✅ Spellcheck toggle.
- [x] ✅ Custom shortcuts.
- [x] ✅ Image drag-and-drop.
- [x] ✅ Project revision refresh (polling).
- [x] ✅ Copy diagnostics/logs.
- [x] ✅ Clean aux files.
- [x] ✅ Configurable build dir.
- [x] ✅ Crash buffer recovery.
- [x] ✅ Unused-file detection.
- [x] ✅ Focus mode.
- [x] ✅ Searchable settings.

---

## 19. Локализация, доступность, responsive

- [x] ✅ EN/RU runtime switch и complete dictionaries.
- [x] ✅ Key-parity test EN/RU.
- [x] ✅ Dark/light/system.
- [x] ✅ Locale dates/numbers в history и новых экранах.
- [x] ✅ Compiler output/source/identifiers не переводятся.
- [x] ✅ Responsive clamp для узкого окна.
- [ ] ⚠️ Полный keyboard-only и ARIA/focus audit новых панелей не завершён.
- [ ] ⚠️ Русские строки требуют финальной визуальной проверки на обрезку.

---

## 20. Безопасность и производительность

- [x] ✅ Project root validation.
- [x] ✅ Path traversal и symlink escape protection.
- [x] ✅ Atomic writes и rollback.
- [x] ✅ No arbitrary shell strings; compiler args as arrays.
- [x] ✅ Preview/restore проверяют пути.
- [x] ✅ Background work для checkpoint/search/doctor через `spawn_blocking`/async.
- [x] ✅ Stale request guards в search/replace/preview.
- [x] ✅ No concurrent builds.
- [x] ✅ Large-file diff ограничен и binary-safe.
- [ ] ⚠️ Полный аудит минимальных Tauri permissions после новых функций не оформлен отдельным тестом.

---

## 21. Тесты и релиз

- [x] ✅ Rust: **34 passed, 4 ignored**.
- [x] ✅ Frontend: **16 passed** (format, equation, table, i18n parity, shortcuts).
- [x] ✅ Ignored Tectonic tests: реальный compile, Book template, SyncTeX, real-project Doctor.
- [x] ✅ Typecheck.
- [x] ✅ Biome без errors (только warnings).
- [x] ✅ Vite production build.
- [x] ✅ Tauri app + DMG bundle.
- [x] ✅ DMG смонтирован, содержимое и checksum проверены.
- [x] ✅ Standalone app установлен из bundle в `~/Applications/LaTeX Studio.app`, запущен.
- [x] ✅ App data сохранены в `~/Library/Application Support/com.latexstudio.desktop`.
- [x] ✅ Real Tectonic compile пользовательского проекта (ранее проверено).
- [x] ✅ History: preview no-write, stale token, restore add/modify/delete, recovery, retention.
- [x] ✅ SyncTeX forward/reverse integration.
- [x] ✅ Static Doctor tests.
- [x] ✅ Equation/table tests.
- [x] ✅ Export tests.
- [ ] ⚠️ Full end-to-end UI workflow и manual visual QA остаются за пользователем.
- [ ] ⚠️ EN/RU и responsive visual regression без скриншотов не автоматизированы.

---

## 22. Финальный статус

1. [x] ✅ Проектные чекпоинты, diff, preview, tree highlighting, transactional restore.
2. [x] ✅ Search/replace, Doctor, SyncTeX.
3. [x] ✅ Equation/table builders, Book template, snippets.
4. [x] ✅ PDF fit page, saved position, crash recovery, stats, focus mode.
5. [x] ✅ Custom shortcuts, BibTeX help, image drag-and-drop, unused-file detection.
6. [x] ✅ Configurable build dir, clean aux, revision refresh.
7. [x] ✅ Tests, production build, app bundle, install, launch.
8. [x] ✅ DMG installer 1.0.0 со ссылкой на Applications и SHA-256.
9. [x] ✅ Старая установленная версия удалена; осталась одна копия приложения.
10. [ ] ⚠️ Пользовательская визуальная приёмка интерфейса.
11. [ ] ⚠️ Notarization возможна только с Apple Developer ID; текущая сборка ad-hoc signed.

---

## Критерий готовности истории

- [x] ✅ Чекпоинт содержит несколько файлов.
- [x] ✅ Фильтры по дате/времени работают.
- [x] ✅ Affected files и `A/M/D/R` показаны.
- [x] ✅ Diff цветной и с номерами строк.
- [x] ✅ Preview не меняет файлы.
- [x] ✅ Дерево подсвечивает затронутые файлы.
- [x] ✅ Restore создаёт recovery checkpoint.
- [x] ✅ Конфликт/внешнее изменение обнаруживается.
- [x] ✅ Partial failure откатывается.
- [x] ✅ Single/full restore работают.
- [ ] ⚠️ EN/RU и light/dark проверены кодом и сборкой, но не visually пользователем.
- [x] ✅ Тесты проходят.

---

## Установщик

- DMG: `release/LaTeX Studio_1.0.0_aarch64.dmg`
- Checksum: `release/SHA256SUMS.txt`
- README: `release/README.md`
- Установленное приложение: `~/Applications/LaTeX Studio.app`
- SHA-256 executable: `723212460d4d2143dc87adac2405a6455d193752240ee5ea54915f3596863860`
- DMG SHA-256: `7fe9d41de4212d97def63ece25c78e9dd60ff7e3fa21b3d22c23019674bd8b38`
