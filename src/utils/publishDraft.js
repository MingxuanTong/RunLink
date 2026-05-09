const STORAGE_KEY = 'runlink-publish-draft'

let draft = null

function hasSessionStorage() {
  return typeof window !== 'undefined' && !!window.sessionStorage
}

export function setPublishDraft(value) {
  draft = value
  if (!hasSessionStorage()) return
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value))
}

export function getPublishDraft() {
  if (draft) return draft
  if (!hasSessionStorage()) return null
  const raw = window.sessionStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    draft = JSON.parse(raw)
    return draft
  } catch {
    window.sessionStorage.removeItem(STORAGE_KEY)
    return null
  }
}

export function clearPublishDraft() {
  draft = null
  if (!hasSessionStorage()) return
  window.sessionStorage.removeItem(STORAGE_KEY)
}
