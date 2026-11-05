import { Eraser, Regex, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store/useAppStore";
import type { SearchMatch } from "../types";

function Highlight({ text, query, regex }: { text: string; query: string; regex: boolean }) {
  if (!query || regex) return <>{text}</>;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
}

export function SearchView() {
  const { t } = useTranslation();
  const searchQuery = useAppStore((state) => state.searchQuery);
  const searchResults = useAppStore((state) => state.searchResults);
  const searchLoading = useAppStore((state) => state.searchLoading);
  const searchError = useAppStore((state) => state.searchError);
  const searchCaseSensitive = useAppStore((state) => state.searchCaseSensitive);
  const searchRegex = useAppStore((state) => state.searchRegex);
  const search = useAppStore((state) => state.search);
  const setSearchCaseSensitive = useAppStore((state) => state.setSearchCaseSensitive);
  const setSearchRegex = useAppStore((state) => state.setSearchRegex);
  const replaceText = useAppStore((state) => state.replaceText);
  const replaceLoading = useAppStore((state) => state.replaceLoading);
  const replaceError = useAppStore((state) => state.replaceError);
  const previewReplace = useAppStore((state) => state.previewReplace);
  const openFile = useAppStore((state) => state.openFile);
  const [localQuery, setLocalQuery] = useState(searchQuery);
  const [replacement, setReplacement] = useState(replaceText);
  const input = useRef<HTMLInputElement>(null);
  const lastSubmitted = useRef(searchQuery);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    setLocalQuery(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    setReplacement(replaceText);
  }, [replaceText]);

  useEffect(() => {
    if (localQuery === lastSubmitted.current) return;
    const timer = setTimeout(() => {
      lastSubmitted.current = localQuery;
      void search(localQuery);
    }, 240);
    return () => clearTimeout(timer);
  }, [localQuery, search]);

  const groups = useMemo(() => {
    const map = new Map<string, SearchMatch[]>();
    for (const match of searchResults) {
      const list = map.get(match.file) ?? [];
      list.push(match);
      map.set(match.file, list);
    }
    return [...map.entries()];
  }, [searchResults]);

  const submit = () => {
    lastSubmitted.current = localQuery;
    void search(localQuery);
  };

  const clear = () => {
    lastSubmitted.current = "";
    setLocalQuery("");
    void search("");
  };

  return (
    <aside className="file-panel search-view">
      <div className="file-panel-header">
        <span className="file-panel-title">{t("search.title")}</span>
        {searchResults.length > 0 ? (
          <span className="sidebar-count">{searchResults.length}</span>
        ) : null}
        {searchQuery ? (
          <button type="button" className="icon-button" title={t("common.clear")} onClick={clear}>
            <Eraser size={13} />
          </button>
        ) : null}
      </div>

      <div className="search-controls">
        <div className="search-input-wrap">
          <Search size={13} />
          <input
            ref={input}
            value={localQuery}
            placeholder={t("search.placeholder")}
            onChange={(event) => setLocalQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />
        </div>
        <div className="search-options">
          <button
            type="button"
            className={`search-option ${searchCaseSensitive ? "active" : ""}`}
            title={t("search.caseSensitive")}
            aria-pressed={searchCaseSensitive}
            onClick={() => void setSearchCaseSensitive(!searchCaseSensitive)}
          >
            Aa
          </button>
          <button
            type="button"
            className={`search-option ${searchRegex ? "active" : ""}`}
            title={t("search.regex")}
            aria-pressed={searchRegex}
            onClick={() => void setSearchRegex(!searchRegex)}
          >
            <Regex size={13} />
          </button>
          <span className="search-hint-inline">
            {searchLoading
              ? t("search.searching")
              : t("search.results", { count: searchResults.length })}
          </span>
        </div>
      </div>

      <div className="search-replace-controls">
        <input
          className="search-replace-input"
          value={replacement}
          placeholder={t("search.replacePlaceholder")}
          onChange={(event) => setReplacement(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && searchQuery.trim()) {
              event.preventDefault();
              void previewReplace(replacement);
            }
          }}
        />
        <button
          type="button"
          className="text-button"
          disabled={!searchQuery.trim() || searchResults.length === 0 || replaceLoading}
          onClick={() => void previewReplace(replacement)}
        >
          {replaceLoading ? t("search.searching") : t("search.replaceAction")}
        </button>
      </div>
      {replaceError ? <div className="search-error">{replaceError}</div> : null}

      <div className="search-results" role="region" aria-live="polite">
        {searchError ? <div className="search-error">{searchError}</div> : null}
        {!searchError && !searchLoading && searchQuery && groups.length === 0 ? (
          <div className="tree-empty">{t("search.noResults")}</div>
        ) : null}
        {!searchQuery ? <div className="tree-empty">{t("search.hint")}</div> : null}
        {groups.map(([file, matches]) => (
          <section key={file} className="search-group">
            <div className="search-file" title={file}>
              <span>{file}</span>
              <span className="search-file-count">{matches.length}</span>
            </div>
            {matches.map((match) => (
              <button
                key={`${match.file}:${match.line}:${match.column}`}
                type="button"
                className="search-result"
                onClick={() => void openFile(match.file, match.line, match.column)}
              >
                <span className="search-line">{match.line}</span>
                <span className="search-preview">
                  <Highlight text={match.preview} query={searchQuery} regex={searchRegex} />
                </span>
              </button>
            ))}
          </section>
        ))}
      </div>
    </aside>
  );
}
