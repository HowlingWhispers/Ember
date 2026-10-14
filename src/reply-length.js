/**
 * Ember-native reply length presets. Shared by browser/compiler/server so the
 * request ceiling and the visible setting always describe the same behavior.
 */
export const DEFAULT_REPLY_LENGTH="normal";
export const REPLY_LENGTHS=Object.freeze({
  short:Object.freeze({label:"Short",targetWords:55,maxWords:80,maxTokens:240}),
  normal:Object.freeze({label:"Normal",targetWords:100,maxWords:135,maxTokens:384}),
  long:Object.freeze({label:"Long",targetWords:195,maxWords:250,maxTokens:680}),
});
export function replyLength(value) {
  if(typeof value!=="string" || !Object.hasOwn(REPLY_LENGTHS,value))
    throw new Error("Choose a valid Ember reply length.");
  return REPLY_LENGTHS[value];
}
export function replyLengthOrDefault(value) {
  return Object.hasOwn(REPLY_LENGTHS,value) ? value : DEFAULT_REPLY_LENGTH;
}
