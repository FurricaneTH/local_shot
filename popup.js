const statusText = document.querySelector("#status");
const toggleButton = document.querySelector("#toggleButton");

function render(enabled) {
  statusText.textContent = enabled
    ? "Sayfa filtreleme açık"
    : "Sayfa filtreleme kapalı";
  toggleButton.textContent = enabled ? "Filtrelemeyi kapat" : "Filtrelemeyi aç";
}

chrome.storage.local.get({ enabled: true }, ({ enabled }) => {
  render(enabled);
});

toggleButton.addEventListener("click", async () => {
  const { enabled } = await chrome.storage.local.get({ enabled: true });
  const nextEnabled = !enabled;

  await chrome.storage.local.set({ enabled: nextEnabled });
  render(nextEnabled);
});
