const elements = {
  chains: document.querySelector("#chains"),
  watchList: document.querySelector("#watchList"),
  watchForm: document.querySelector("#watchForm"),
  formFeedback: document.querySelector("#formFeedback"),
  refreshButton: document.querySelector("#refreshButton"),
  watchDetails: document.querySelector("#watchDetails"),
  selectedWatchBadge: document.querySelector("#selectedWatchBadge"),
};

let state = {
  registry: [],
  watches: [],
  selectedWatchId: null,
};

async function loadRegistry() {
  const response = await fetch("/v1/registry");
  const payload = await response.json();
  state.registry = payload.chains;
  renderChains();
}

async function loadWatches() {
  const response = await fetch("/v1/watches");
  const payload = await response.json();
  state.watches = payload.items;
  renderWatches();

  if (state.selectedWatchId) {
    await showWatch(state.selectedWatchId);
  }
}

function renderChains() {
  elements.chains.innerHTML = "";

  for (const chain of state.registry) {
    const label = document.createElement("label");
    label.className = "chip";
    label.innerHTML = `
      <input type="checkbox" name="chains" value="${chain.key}" />
      <span>${chain.name}</span>
    `;
    elements.chains.appendChild(label);
  }
}

function renderWatches() {
  if (state.watches.length === 0) {
    elements.watchList.innerHTML = `<p class="details empty">No watches yet.</p>`;
    return;
  }

  elements.watchList.innerHTML = state.watches
    .map((watch) => {
      const activeTargets = watch.targets.filter((target) => target.isActive);
      return `
        <article class="watch-item">
          <h3>${watch.label || "Unlabeled watch"}</h3>
          <div class="mono">${watch.address}</div>
          <p>${activeTargets.length} active token monitors</p>
          <button class="ghost" type="button" data-watch-id="${watch.id}">Inspect</button>
        </article>
      `;
    })
    .join("");

  for (const button of elements.watchList.querySelectorAll("[data-watch-id]")) {
    button.addEventListener("click", async (event) => {
      const watchId = event.currentTarget.getAttribute("data-watch-id");
      await showWatch(watchId);
    });
  }
}

async function showWatch(watchId) {
  state.selectedWatchId = watchId;
  const [watchResponse, payersResponse, paymentsResponse] = await Promise.all([
    fetch(`/v1/watches/${watchId}`),
    fetch(`/v1/watches/${watchId}/payers`),
    fetch(`/v1/watches/${watchId}/payments?limit=10`),
  ]);

  if (!watchResponse.ok) {
    elements.watchDetails.innerHTML = `<p class="details empty">Selected watch no longer exists.</p>`;
    elements.selectedWatchBadge.textContent = "Missing";
    return;
  }

  const watch = await watchResponse.json();
  const payers = await payersResponse.json();
  const payments = await paymentsResponse.json();

  elements.selectedWatchBadge.textContent = watch.label || "Watching";

  const targets = watch.targets
    .filter((target) => target.isActive)
    .map(
      (target) => `
        <div class="table-row">
          <strong>${target.chainKey}</strong>
          <div>${target.tokenSymbol} · synced to ${target.lastSyncedBlock ?? "pending"}${target.lastError ? ` · error: ${target.lastError}` : ""}</div>
        </div>
      `,
    )
    .join("");

  const payerRows = payers.items.length
    ? payers.items
        .map(
          (payer) => `
            <div class="table-row">
              <strong>${payer.tokenSymbol}</strong>
              <div>
                <div class="mono">${payer.payerAddress}</div>
                <div>${payer.totalAmount} ${payer.tokenSymbol} across ${payer.paymentCount} payment(s)</div>
              </div>
            </div>
          `,
        )
        .join("")
    : `<p class="details empty">No finalized payments recorded yet.</p>`;

  const paymentRows = payments.items.length
    ? payments.items
        .map(
          (payment) => `
            <div class="table-row">
              <strong>${payment.tokenSymbol}</strong>
              <div>
                <div>${payment.amount} ${payment.tokenSymbol} from <span class="mono">${payment.payerAddress}</span></div>
                <div class="mono">${payment.txHash}</div>
              </div>
            </div>
          `,
        )
        .join("")
    : `<p class="details empty">No payment events yet.</p>`;

  elements.watchDetails.innerHTML = `
    <section class="meta">
      <div class="meta-row">
        <strong>Address</strong>
        <span class="mono">${watch.address}</span>
      </div>
      <div class="meta-row">
        <strong>Version</strong>
        <span>${watch.dataVersion}</span>
      </div>
      <div class="meta-row">
        <strong>Targets</strong>
        <div class="table">${targets || `<p class="details empty">No active targets.</p>`}</div>
      </div>
    </section>
    <section class="subsection">
      <h3>Payers</h3>
      <div class="table">${payerRows}</div>
    </section>
    <section class="subsection">
      <h3>Recent payments</h3>
      <div class="table">${paymentRows}</div>
    </section>
  `;
}

elements.watchForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(elements.watchForm);
  const payload = {
    address: formData.get("address"),
    label: formData.get("label") || undefined,
    chains: formData.getAll("chains"),
    includeDefaultTokens: Boolean(formData.get("includeDefaults")),
    lookbackBlocks: formData.get("lookbackBlocks") ? Number(formData.get("lookbackBlocks")) : undefined,
  };

  try {
    const response = await fetch("/v1/watches", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error || "Failed to save watch");
    }

    elements.formFeedback.textContent = JSON.stringify(body, null, 2);
    await loadWatches();
    await showWatch(body.id);
  } catch (error) {
    elements.formFeedback.textContent = error instanceof Error ? error.message : String(error);
  }
});

elements.refreshButton.addEventListener("click", async () => {
  await loadRegistry();
  await loadWatches();
});

await loadRegistry();
await loadWatches();
