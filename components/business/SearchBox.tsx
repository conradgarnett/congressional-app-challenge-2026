"use client";

import { useId, useMemo, useState } from "react";

import { GROUPS, categoryLabel } from "@/lib/groups";
import { loadSearchIndex, search, type SearchEntry } from "@/lib/search";
import styles from "./SearchBox.module.css";

interface Props {
  currentDistrict: string;
  onPick: (entry: SearchEntry) => void;
}

export default function SearchBox({ currentDistrict, onPick }: Props) {
  const listId = useId();
  const [entries, setEntries] = useState<SearchEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const results = useMemo(
    () => (entries ? search(entries, query, currentDistrict) : []),
    [entries, query, currentDistrict],
  );

  function load() {
    if (entries) return;
    loadSearchIndex()
      .then((loaded) => {
        setEntries(loaded);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }

  function pick(entry: SearchEntry) {
    onPick(entry);
    setQuery(entry.name);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter" && results[active]) {
      event.preventDefault();
      pick(results[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && query.trim().length >= 2;

  return (
    <div className={styles.box}>
      <input
        type="search"
        className={styles.input}
        placeholder="Search businesses by name or street"
        aria-label="Search businesses"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        value={query}
        onFocus={() => {
          load();
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <ul id={listId} className={styles.list} role="listbox">
          {failed && <li className={styles.note}>Search is unavailable right now.</li>}
          {!failed && !entries && <li className={styles.note}>Loading…</li>}
          {entries && results.length === 0 && <li className={styles.note}>No small businesses match.</li>}
          {results.map((entry, i) => {
            const group = GROUPS.find((g) => g.id === entry.group);
            return (
              <li
                key={entry.id}
                role="option"
                aria-selected={i === active}
                className={styles.option}
                // mousedown, not click: fires before the input's blur closes the list
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(entry);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className={styles.dot} style={{ background: group?.color }} aria-hidden />
                <span className={styles.text}>
                  <span className={styles.name}>{entry.name}</span>
                  <span className={styles.meta}>
                    {categoryLabel(entry.category)}
                    {entry.city && ` · ${entry.city}`}
                    {entry.district !== currentDistrict && ` · ${entry.district}`}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
