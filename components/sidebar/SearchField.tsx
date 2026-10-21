"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { GROUPS } from "@/lib/groups";
import { loadSearchIndex, search, type SearchEntry, type TagMatch } from "@/lib/search";
import type { Bounds } from "@/lib/geo/tiles";
import type { GroupId } from "@/types/business";
import styles from "./Sidebar.module.css";

type Option = { kind: "tag"; match: TagMatch } | { kind: "place"; entry: SearchEntry };

interface Props {
  view: Bounds | null;
  onPickPlace: (entry: SearchEntry) => void;
  onPickTag: (tag: string, group: GroupId) => void;
}

/** Search every business by name, type, street or town. "/" focuses it from anywhere. */
export default function SearchField({ view, onPickPlace, onPickTag }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<SearchEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function load() {
    if (entries || failed) return;
    loadSearchIndex().then(setEntries, () => setFailed(true));
  }

  const results = useMemo(() => (entries ? search(entries, query, view, 8) : null), [entries, query, view]);
  const options: Option[] = useMemo(
    () => [
      ...(results?.tagMatch ? [{ kind: "tag" as const, match: results.tagMatch }] : []),
      ...(results?.entries ?? []).map((entry) => ({ kind: "place" as const, entry })),
    ],
    [results],
  );

  function choose(option: Option) {
    if (option.kind === "tag") {
      onPickTag(option.match.tag, option.match.group);
      setQuery(option.match.label);
    } else {
      onPickPlace(option.entry);
      setQuery(option.entry.name);
    }
    setOpen(false);
    input.current?.blur();
  }

  const showList = open && query.trim().length >= 2;
  return (
    <div className={styles.search}>
      <label className={styles.visuallyHidden} htmlFor="search">
        Search businesses
      </label>
      <input
        ref={input}
        id="search"
        className={styles.searchInput}
        type="search"
        autoComplete="off"
        placeholder="Search: tacos, barber, a name or street"
        value={query}
        role="combobox"
        aria-expanded={showList}
        aria-controls="search-results"
        onFocus={() => {
          load();
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") setActive((i) => Math.min(i + 1, options.length - 1));
          else if (event.key === "ArrowUp") setActive((i) => Math.max(i - 1, 0));
          else if (event.key === "Enter" && options[active]) choose(options[active]);
          else if (event.key === "Escape") {
            setOpen(false);
            input.current?.blur();
          } else return;
          event.preventDefault();
        }}
      />
      <kbd className={styles.searchKey} aria-hidden>
        /
      </kbd>
      {showList && (
        <ul id="search-results" className={styles.searchResults} role="listbox">
          {failed && <li className={styles.searchNote}>Search didn’t load. Check your connection, then try again.</li>}
          {!failed && !entries && <li className={styles.searchNote}>Loading every business…</li>}
          {entries && options.length === 0 && <li className={styles.searchNote}>No independent business matches that.</li>}
          {options.map((option, i) => (
            <li
              key={option.kind === "tag" ? `tag:${option.match.tag}` : option.entry.id}
              role="option"
              aria-selected={i === active}
              className={styles.searchOption}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(option)}
            >
              {option.kind === "tag" ? (
                <>
                  <span className={styles.optionName}>Show every {option.match.label.toLowerCase()} place</span>
                  <span className={styles.optionMeta}>
                    {option.match.count.toLocaleString()} on screen in{" "}
                    {GROUPS.find((g) => g.id === option.match.group)?.label.toLowerCase()}
                  </span>
                </>
              ) : (
                <>
                  <span className={styles.optionName}>{option.entry.name}</span>
                  <span className={styles.optionMeta}>
                    {[option.entry.street, option.entry.city].filter(Boolean).join(", ") || "Address not listed"}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
