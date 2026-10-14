// Private, per-story Coda suggestions. No Orbis writes and no canon changes.
const PREFIX = "hw:ember:coda-characters:v1";
const clean = value => typeof value === "string" ? value.trim().slice(0, 200) : "";
export function parseCodaCandidate(raw) {
  if (typeof raw !== "string") return null;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start || end - start > 4000) return null;
  let data;
  try { data = JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
  const c = data?.candidate;
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  const name = clean(c.name);
  const role = clean(c.role);
  const established = clean(c.established);
  const suggestions = clean(c.suggestions);
  if (!name || (!established && !role)) return null;
  return {name, role, established, suggestions};
}
export function emptyDiscovery() { return {pending:null,profiles:[],lastChecked:0}; }
export function discoveryKey(userId, storyId) {
  return `${PREFIX}:${String(userId ?? "offline")}:${String(storyId)}`;
}
export function loadDiscovery(userId, storyId) {
  try {
    const data = JSON.parse(localStorage.getItem(discoveryKey(userId, storyId)) || "null");
    if (!data || !Array.isArray(data.profiles)) return emptyDiscovery();
    return {
      pending: data.pending && parseCodaCandidate(JSON.stringify({candidate:data.pending})),
      profiles: data.profiles.slice(0, 80).map(profile => ({
        name:clean(profile?.name), role:clean(profile?.role),
        established:clean(profile?.established),suggestions:clean(profile?.suggestions),
      })).filter(profile => profile.name),
      lastChecked: Number.isSafeInteger(data.lastChecked) && data.lastChecked >= 0 ? data.lastChecked : 0,
    };
  } catch { return emptyDiscovery(); }
}
export function saveDiscovery(userId, storyId, data) {
  localStorage.setItem(discoveryKey(userId, storyId), JSON.stringify(data));
}
export function shouldDiscover(turns, data) {
  if (data.pending || turns.at(-1)?.source !== "provider") return false;
  const playerCount = turns.filter(turn => turn.source === "player").length;
  const providerCount = turns.filter(turn => turn.source === "provider").length;
  return playerCount >= 4 && providerCount >= 4 && playerCount >= data.lastChecked + 3;
}
