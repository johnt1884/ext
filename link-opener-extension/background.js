// -----------------------------
// CONFIG (smarter + human-like)
// -----------------------------
const BATCH_SIZE = 3;

const MIN_DELAY = 2000;
const MAX_DELAY = 6000;

const MIN_BATCH_DELAY = 8000;
const MAX_BATCH_DELAY = 20000;

const LONG_PAUSE_EVERY = 20;
const LONG_PAUSE_MIN = 30000;
const LONG_PAUSE_MAX = 90000;

// -----------------------------
// UTIL
// -----------------------------
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// -----------------------------
// CORE LOGIC
// -----------------------------
function transformSpecialUrl(url) {
    if (!url) return url;
    const decodedUrl = decodeURIComponent(url);
    if (decodedUrl.includes(" #") || url.includes("%20#") || url.includes("%20%23") || decodedUrl.includes(" %23")) {
        const match = decodedUrl.match(/@([^\/ #?%]+)/);
        if (match) {
            const username = match[1];
            return `https://ssstiktok.dev/#username=${username}`;
        }
    }
    return url;
}

async function openTabsSmart(urls) {
    urls = urls.map(transformSpecialUrl);

    const [currentTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    let openedCount = 0;

    for (let i = 0; i < urls.length; i += BATCH_SIZE) {
        const batch = urls.slice(i, i + BATCH_SIZE);

        for (const url of batch) {
            try {
                const tab = await chrome.tabs.create({
                    url: url,
                    active: false
                });

                chrome.tabs.update(tab.id, {
                    autoDiscardable: false
                });

                openedCount++;

                // human-like delay
                await sleep(rand(MIN_DELAY, MAX_DELAY));

            } catch (err) {
                console.warn("Tab open failed:", err);

                // backoff if something weird happens
                await sleep(rand(15000, 40000));
            }
        }

        // long pause every X tabs (very important)
        if (openedCount % LONG_PAUSE_EVERY === 0) {
            await sleep(rand(LONG_PAUSE_MIN, LONG_PAUSE_MAX));
        }

        // batch delay
        if (i + BATCH_SIZE < urls.length) {
            await sleep(rand(MIN_BATCH_DELAY, MAX_BATCH_DELAY));
        }
    }

}

// -----------------------------
// STAGGERED LOGIC
// -----------------------------
let staggeredList = [];
let currentStaggeredTabId = null;
let staggeredOpenerTabId = null;

async function startStaggered(urls, openerTabId) {
    if (!urls || urls.length === 0) return;
    
    urls = urls.map(transformSpecialUrl);

    const total = urls.length;
    const currentIndex = 1;
    staggeredList = [...urls];
    staggeredOpenerTabId = openerTabId;
    const nextUrl = staggeredList[0];
    
    const tab = await chrome.tabs.create({ url: nextUrl, active: true });
    currentStaggeredTabId = tab.id;
    
    // Save state in storage before completing
    await chrome.storage.local.set({ 
        staggeredList,
        currentStaggeredTabId,
        staggeredOpenerTabId,
        staggeredTotal: total,
        staggeredCurrentIndex: currentIndex
    });
}

async function nextStaggered(senderTabId) {
    const data = await chrome.storage.local.get(['staggeredList', 'staggeredQueue', 'currentStaggeredTabId', 'staggeredOpenerTabId', 'staggeredTotal', 'staggeredCurrentIndex']);
    staggeredList = data.staggeredList || data.staggeredQueue || staggeredList || [];
    currentStaggeredTabId = data.currentStaggeredTabId || currentStaggeredTabId;
    staggeredOpenerTabId = data.staggeredOpenerTabId || staggeredOpenerTabId;
    let total = data.staggeredTotal || staggeredList.length;
    let currentIndex = data.staggeredCurrentIndex || 1;

    const tabToClose = senderTabId || currentStaggeredTabId;

    let wasActive = true;
    if (tabToClose) {
        try {
            const tab = await chrome.tabs.get(tabToClose);
            wasActive = tab.active;
        } catch (e) {}
    }

    if (currentIndex < total) {
        currentIndex++;
        const nextUrl = staggeredList[currentIndex - 1];
        const newTab = await chrome.tabs.create({ url: nextUrl, active: wasActive });
        currentStaggeredTabId = newTab.id;
    } else {
        currentStaggeredTabId = null;
        if (staggeredOpenerTabId) {
            chrome.tabs.sendMessage(staggeredOpenerTabId, { type: "STAGGERED_FINISHED" }).catch(() => {});
        }
    }

    await chrome.storage.local.set({
        staggeredList,
        currentStaggeredTabId,
        staggeredCurrentIndex: currentIndex
    });

    if (tabToClose) {
        try {
            await chrome.tabs.remove(tabToClose);
        } catch (e) {
            console.warn("Could not remove tab:", e);
        }
    }
}

async function prevStaggered(senderTabId) {
    const data = await chrome.storage.local.get(['staggeredList', 'staggeredQueue', 'currentStaggeredTabId', 'staggeredOpenerTabId', 'staggeredTotal', 'staggeredCurrentIndex']);
    staggeredList = data.staggeredList || data.staggeredQueue || staggeredList || [];
    currentStaggeredTabId = data.currentStaggeredTabId || currentStaggeredTabId;
    staggeredOpenerTabId = data.staggeredOpenerTabId || staggeredOpenerTabId;
    let currentIndex = data.staggeredCurrentIndex || 1;

    if (currentIndex <= 1) {
        return; // Already at the first item
    }

    const tabToClose = senderTabId || currentStaggeredTabId;

    let wasActive = true;
    if (tabToClose) {
        try {
            const tab = await chrome.tabs.get(tabToClose);
            wasActive = tab.active;
        } catch (e) {}
    }

    currentIndex--;
    const prevUrl = staggeredList[currentIndex - 1];
    const newTab = await chrome.tabs.create({ url: prevUrl, active: wasActive });
    currentStaggeredTabId = newTab.id;

    await chrome.storage.local.set({
        staggeredList,
        currentStaggeredTabId,
        staggeredCurrentIndex: currentIndex
    });

    if (tabToClose) {
        try {
            await chrome.tabs.remove(tabToClose);
        } catch (e) {
            console.warn("Could not remove tab:", e);
        }
    }
}

// -----------------------------
// ACTION (EXTENSION ICON CLICK)
// -----------------------------
chrome.action.onClicked.addListener((tab) => {
    chrome.tabs.sendMessage(tab.id, { type: "ACTION_CLICKED" }).catch(() => {
        // Fallback if content script not loaded/ready
        console.warn("Action clicked but content script not responding in tab", tab.id);
    });
});

// -----------------------------
// MESSAGE LISTENER
// -----------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "OPEN_TABS_SMART") {
        openTabsSmart(message.urls);
    } else if (message.type === "START_STAGGERED") {
        startStaggered(message.urls, sender.tab?.id);
    } else if (message.type === "NEXT_STAGGERED") {
        nextStaggered(sender.tab?.id);
    } else if (message.type === "PREV_STAGGERED") {
        prevStaggered(sender.tab?.id);
    } else if (message.type === "PLAY_SOUND") {
        chrome.storage.local.get(['staggeredOpenerTabId']).then(data => {
            if (data.staggeredOpenerTabId) {
                chrome.tabs.sendMessage(data.staggeredOpenerTabId, { type: "PLAY_SOUND", sound: message.sound }).catch(() => {});
            }
        });
    } else if (message.type === "CHECK_STAGGERED") {
        chrome.storage.local.get(['currentStaggeredTabId', 'staggeredTotal', 'staggeredCurrentIndex', 'staggeredList']).then(data => {
            // Check if sender tab matches currentStaggeredTabId OR if current tab URL is in staggeredList
            const tabUrl = sender.tab?.url ? transformSpecialUrl(sender.tab.url) : null;
            const list = data.staggeredList || [];
            const isMatch = sender.tab && (sender.tab.id === data.currentStaggeredTabId || (tabUrl && list.includes(tabUrl)));
            sendResponse({
                isStaggered: isMatch,
                total: data.staggeredTotal,
                currentIndex: data.staggeredCurrentIndex
            });
        });
        return true; // async response
    }
});
