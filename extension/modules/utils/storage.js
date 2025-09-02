// storage.js - Chrome storage utilities and constants

// Stored tab info keys
export const STORAGE_KEYS = {
  TAB_ID: "attachedTabId",
  TAB_TITLE: "attachedTabTitle",
  LAST_EVENT_NUMBER: "lastGtmEventNumber", // For tracking GTM event numbers
  PREVIEW_SESSION: "gtmPreviewCb" // For tracking preview session callback ID
};

// GA4 hits storage - per tab
export const ga4HitsPerTab = new Map(); // tabId -> hits array
export const MAX_HITS_PER_PAGE = 50;

// Meta Pixel hits storage - per tab
export const metaPixelHitsPerTab = new Map(); // tabId -> hits array
export const MAX_META_PIXEL_HITS_PER_PAGE = 50;

// Storage helper functions
export async function getStoredValue(key) {
  try {
    const result = await chrome.storage.local.get([key]);
    return result[key] || null;
  } catch (error) {
    console.error(`Failed to get stored value for key ${key}:`, error);
    return null;
  }
}

export async function setStoredValue(key, value) {
  try {
    await chrome.storage.local.set({ [key]: value });
    return true;
  } catch (error) {
    console.error(`Failed to set stored value for key ${key}:`, error);
    return false;
  }
}

export async function removeStoredValue(key) {
  try {
    await chrome.storage.local.remove([key]);
    return true;
  } catch (error) {
    console.error(`Failed to remove stored value for key ${key}:`, error);
    return false;
  }
}

