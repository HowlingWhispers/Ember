// Ember-owned deterministic lore activation. Imported text is data, not policy.
const tokenEstimate = value => Math.ceil([...String(value)].length / 4);
const escapeRegex = s => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
function contains(haystack, needle, sensitive, wholeWord = true) {
  if (!needle) return false;
  const start = wholeWord && /^\w/.test(needle) ? "\\b" : "";
  const end = wholeWord && /\w$/.test(needle) ? "\\b" : "";
  return new RegExp(start + escapeRegex(needle) + end, sensitive ? "u" : "iu").test(haystack);
}
function deterministicRoll(seed) {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % 100;
}
export function checkLoreEntry(entry, context, book, round = 0) {
  if (!entry.enabled || !entry.content.trim()) return { active:false, reason:"disabled or empty" };
  if (round > 0 && entry.excludeRecursion) return { active:false, reason:"excluded from recursion" };
  const depth = entry.depth >= 0 ? entry.depth : book.scanDepth;
  const scanned = Array.isArray(context) ? (depth ? context.slice(-depth) : []).join("\n") : String(context);
  const primaryMatch = entry.keys.some(key => contains(scanned, key, entry.caseSensitive, entry.matchWholeWords !== false));
  if (!entry.constant && !primaryMatch) return { active:false, reason:"no primary keyword match" };
  if (!entry.constant && entry.selective && entry.secondaryKeys.length) {
    const matches = entry.secondaryKeys.map(key => contains(scanned, key, entry.caseSensitive, entry.matchWholeWords !== false));
    const any = matches.some(Boolean), all = matches.length > 0 && matches.every(Boolean);
    const accepted = entry.selectiveLogic === 0 ? any
      : entry.selectiveLogic === 1 ? !all
      : entry.selectiveLogic === 2 ? !any
      : entry.selectiveLogic === 3 ? all : false;
    if (!accepted) return {active:false,reason:"secondary keyword condition not met"};
  }
  if (entry.useProbability && deterministicRoll(entry.sourceId + "|" + scanned) >= entry.probability) {
    return {active:false,reason:"probability condition not met"};
  }
  return { active:true, reason:entry.constant ? "constant" : "keyword match" };
}
export function activateLorebooks(books, turns, maxTokens = 6000) {
  const found = [], diagnostics = [], all = [];
  for (const bookInfo of books) {
    const book = bookInfo?.fields || bookInfo;
    if (!book || !Array.isArray(book.entries)) continue;
    const id = String(bookInfo?.id || book.name || "lorebook");
    const budget = Math.max(0, Math.min(book.tokenBudget, maxTokens));
    for (const entry of book.entries) all.push({book,bookId:id,entry,budget});
  }
  all.sort((a,b) => b.entry.priority - a.entry.priority || a.entry.insertionOrder - b.entry.insertionOrder || a.bookId.localeCompare(b.bookId) || a.entry.sourceId.localeCompare(b.entry.sourceId));
  const budgetUsed = new Map();
  let total = 0;
  const included = new Set();
  const scan = Array.isArray(turns) ? turns.map(t=>typeof t === "string" ? t : t.text || "") : [String(turns)];
  const consider = (round, extra) => {
    let added = 0;
    for (const item of all) {
      const id = item.bookId + ":" + item.entry.sourceId;
      if (included.has(id)) continue;
      const check = checkLoreEntry(item.entry, [...scan, ...extra], item.book, round);
      if (!check.active) {
        if (round === 0) diagnostics.push({bookId:item.bookId,entryId:item.entry.sourceId,included:false,reason:check.reason});
        continue;
      }
      const cost = tokenEstimate(item.entry.content);
      const used = budgetUsed.get(item.bookId) || 0;
      let reason = check.reason;
      if (used + cost > item.budget) reason = "lorebook token budget";
      else if (total + cost > maxTokens) reason = "story lore token budget";
      if (reason !== check.reason) {
        if (round === 0) diagnostics.push({bookId:item.bookId,entryId:item.entry.sourceId,included:false,reason});
        continue;
      }
      found.push({bookId:item.bookId,entryId:item.entry.sourceId,title:item.entry.name,content:item.entry.content,tokens:cost,reason});
      diagnostics.push({bookId:item.bookId,entryId:item.entry.sourceId,included:true,reason,tokens:cost});
      included.add(id); total += cost; budgetUsed.set(item.bookId,used + cost); added++;
    }
    return added;
  };
  consider(0,[]);
  for (let i=1; i<=3 && books.some(b => (b.fields || b).recursiveScanning); i++) {
    const extra = found.filter(f => {
      const book = books.find(b => String(b.id || b.fields?.name || b.name) === f.bookId);
      return Boolean((book?.fields || book)?.recursiveScanning);
    }).map(f => f.content);
    if (!extra.length || consider(i,extra) === 0) break;
  }
  return { entries:found, diagnostics, estimatedTokens:total,
    context: found.map(f => "Lore: " + f.title + "\n" + f.content).join("\n\n") };
}
