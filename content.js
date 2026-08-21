const DEFAULT_ENABLED = true;

// Bunlar reklam alanlarında sık görülen CSS sınıfı ve id örnekleridir.
// Her site aynı isimleri kullanmadığı için bu liste zamanla geliştirilebilir.
const AD_SELECTORS = [
  ".ad",
  ".ads",
  ".advert",
  ".advertisement",
  ".ad-banner",
  ".ad-container",
  "[id^='ad-']",
  "[id^='ads-']",
  "[id*='advert']",
  "[class*='advert']"
];

function hideAds() {
  for (const selector of AD_SELECTORS) {
    let elements;

    try {
      elements = document.querySelectorAll(selector);
    } catch (error) {
      console.error("Geçersiz reklam seçicisi:", selector, error);
      continue;
    }

    for (const element of elements) {
      element.dataset.learnedAdBlockerHidden = "true";
      element.style.setProperty("display", "none", "important");
    }
  }
}

function showAds() {
  const hiddenElements = document.querySelectorAll(
    "[data-learned-ad-blocker-hidden='true']"
  );

  for (const element of hiddenElements) {
    element.style.removeProperty("display");
    delete element.dataset.learnedAdBlockerHidden;
  }
}

function applyFilter(enabled) {
  if (enabled) {
    hideAds();
  } else {
    showAds();
  }
}

chrome.storage.local.get({ enabled: DEFAULT_ENABLED }, ({ enabled }) => {
  applyFilter(enabled);
});

// Sayfa sonradan yeni içerik eklerse reklam seçicilerini tekrar çalıştırırız.
const observer = new MutationObserver(() => {
  chrome.storage.local.get({ enabled: DEFAULT_ENABLED }, ({ enabled }) => {
    if (enabled) hideAds();
  });
});

if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.enabled) {
    applyFilter(changes.enabled.newValue);
  }
});
