import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Plus, Search } from "lucide-react";
import { cn } from "./ui";

export interface SearchSelectOption {
  id: string;
  label: string;
  /** Smaller second line (an amount and date, an account…). */
  detail?: string;
  color?: string;
  /** Shown indented under the option before it (a subcategory under its parent). */
  indent?: boolean;
  /** Extra text the search matches besides the label. */
  keywords?: string;
}

/**
 * A select field whose list opens with a search box: type to filter, arrows to move, Enter to pick.
 * Used where a long list of choices (categories, entries to refund) used to be a wall of chips.
 */
export function SearchSelect({
  id,
  options,
  value,
  onChange,
  placeholder = "Select",
  clearLabel,
  searchPlaceholder = "Search",
  emptyText = "Nothing matches.",
  onAddNew,
  addNewLabel = "Add new",
  "aria-describedby": describedBy,
}: {
  id?: string;
  options: SearchSelectOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  /** When set, the list starts with this option, which clears the choice. */
  clearLabel?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  onAddNew?: () => void;
  addNewLabel?: string;
  "aria-describedby"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const selected = options.find((o) => o.id === value) ?? null;

  const q = query.trim().toLowerCase();
  const items = useMemo(() => {
    const matches = q ? options.filter((o) => `${o.label} ${o.detail ?? ""} ${o.keywords ?? ""}`.toLowerCase().includes(q)) : options;
    return [
      ...(clearLabel && !q ? [{ id: "", label: clearLabel } as SearchSelectOption] : []),
      ...matches,
    ];
  }, [options, q, clearLabel]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onPointerDown, true);
    return () => document.removeEventListener("mousedown", onPointerDown, true);
  }, [open]);

  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function openList() {
    setOpen(true);
    setQuery("");
    setActive(Math.max(0, items.findIndex((o) => o.id === (value ?? ""))));
  }

  function close() {
    setOpen(false);
    setQuery("");
  }

  function pick(option: SearchSelectOption) {
    onChange(option.id || null);
    close();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[active]) pick(items[active]);
    }
  }

  return (
    <div ref={root} className="relative">
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-describedby={describedBy}
        onClick={() => (open ? close() : openList())}
        className={cn(
          "flex h-11 w-full items-center gap-2 rounded-xl border border-line bg-surface/70 px-3.5 text-left text-sm transition duration-150 ease-swift",
          "hover:border-line-strong focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15"
        )}
      >
        {selected?.color && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: selected.color }} />}
        <span className={cn("min-w-0 flex-1 truncate", selected ? "text-ink" : "text-ink-subtle")}>
          {selected ? selected.label : placeholder}
          {selected?.detail && <span className="ml-2 text-xs text-ink-subtle">{selected.detail}</span>}
        </span>
        <ChevronDown size={15} aria-hidden className="shrink-0 text-ink-subtle" />
      </button>

      {open && (
        // In the flow rather than floating: forms live in scrolling modals, which clipped a popup.
        <div className="mt-1.5 animate-scale-in rounded-2xl border border-line bg-surface p-2 shadow-float">
          <div className="relative mb-1.5">
            <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              className="h-10 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-ink-subtle focus:border-brand-500 focus:outline-none"
            />
          </div>
          <ul ref={list} role="listbox" className="max-h-56 overflow-y-auto">
            {items.map((o, i) => {
              const isSelected = (value ?? "") === o.id;
              return (
                <li
                  key={o.id || "__clear"}
                  role="option"
                  aria-selected={isSelected}
                  data-index={i}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(o)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm",
                    o.indent && !q && "ml-5",
                    i === active ? "bg-surface-sunken" : "",
                    isSelected && "font-semibold text-brand-600"
                  )}
                >
                  {o.color && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: o.color }} />}
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate", !o.id && "text-ink-muted")}>{o.label}</span>
                    {o.detail && <span className="block truncate text-xs font-normal text-ink-subtle">{o.detail}</span>}
                  </span>
                  {isSelected && <Check size={15} className="shrink-0" />}
                </li>
              );
            })}
            {items.length === 0 && <li className="px-3 py-2 text-sm text-ink-subtle">{emptyText}</li>}
          </ul>
          {onAddNew && (
            <button
              type="button"
              onClick={() => {
                close();
                onAddNew();
              }}
              className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-brand-600 hover:bg-surface-sunken"
            >
              <Plus size={15} />
              {addNewLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
