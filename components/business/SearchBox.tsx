"use client";

import { useId, useMemo, useState } from "react";

import { GROUPS, categoryLabel } from "@/lib/groups";
import { loadSearchIndex, search, type SearchEntry, type TagMatch } from "@/lib/search";
import { tagLabel } from "@/lib/tags";
import type { GroupId } from "@/types/business";
import styles from "./SearchBox.module.css";

interface Props {
  currentDistrict: string;
  onPick: (entry: SearchEntry) => void;
  /** "Show all pizza places": filter the map to a tag */
  onPickTag: (tag: string, group: GroupId) => void;
}

type Option = { kind: "tag"; match: TagMatch } | { kind: "entry"; entry: SearchEntry };

export default function SearchBox({ currentDistrict, onPick, onPickTag }: Props) {
  const listId = useId();
  const [entries, setEntries] = useState<SearchEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const results = useMemo(
    () => (entries ? search(entries, query, currentDistrict) : null),
    [entries, query, currentDistrict],
  );
  const options = useMemo<Option[]>(
    () => [
      ...(results?.tagMatch ? [{ kind: "tag" as const, match: results.tagMatch }] : []),
      ...(results?.entries ?? []).map((entry) => ({ kind: "entry" as const, entry })),
    ],
    [results],
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

  function pick(option: Option) {
    if (option.kind === "tag") {
      onPickTag(option.match.tag, option.match.group);
      setQuery(option.match.label);
    } else {
      onPick(option.entry);
      setQuery(option.entry.name);
    }
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter" && options[active]) {
      event.preventDefault();
      pick(options[active]);
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
        placeholder="Search: pizza, barber, a name or street…"
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
          {entries && options.length === 0 && <li className={styles.note}>No small businesses match.</li>}
          {options.map((option, i) => {
            const groupId = option.kind === "tag" ? option.match.group : option.entry.group;
            const group = GROUPS.find((g) => g.id === groupId);
            const tagMatch = results?.tagMatch;
            // Say why a business matched when its name doesn't show it
            const why =
              option.kind === "entry" && tagMatch && option.entry.tags.includes(tagMatch.tag)
                ? tagLabel(tagMatch.tag)
                : null;
            return (
              <li
                key={option.kind === "tag" ? `tag:${option.match.tag}` : option.entry.id}
                role="option"
                aria-selected={i === active}
                className={option.kind === "tag" ? `${styles.option} ${styles.tagOption}` : styles.option}
                // mousedown, not click: fires before the input's blur closes the list
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(option);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className={styles.dot} style={{ background: group?.color }} aria-hidden />
                {option.kind === "tag" ? (
                  <span className={styles.text}>
                    <span className={styles.name}>
                      {option.match.label}: show all {option.match.count} on the map
                    </span>
                    <span className={styles.meta}>In this district</span>
                  </span>
                ) : (
                  <span className={styles.text}>
                    <span className={styles.name}>{option.entry.name}</span>
                    <span className={styles.meta}>
                      {why ?? categoryLabel(option.entry.category)}
                      {option.entry.city && ` · ${option.entry.city}`}
                      {option.entry.district !== currentDistrict && ` · ${option.entry.district}`}
                    </span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
