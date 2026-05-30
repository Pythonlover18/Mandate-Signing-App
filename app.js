(function () {
  const app = document.getElementById("app");

  const state = {
    user: null,
    users: [],
    pipeline: [],
    mandates: [],
    tab: "pipeline",
    pipelineEditId: null,
    mandateEditId: null,
    convertPipelineId: null,
    pipelineForm: defaultPipelineForm(),
    mandateForm: defaultMandateForm(),
    convertForm: defaultConvertForm(),
    adminFilters: {
      mandateType: "",
      ownerId: ""
    },
    pipelineFilters: {
      requirementType: "",
      ownerId: ""
    },
    flashError: "",
    flashSuccess: ""
  };

  const mandateTypeOptions = [
    { value: "debt", label: "Debt" },
    { value: "equity", label: "Equity" },
    { value: "ancillary", label: "Ancillary" }
  ];

  const pipelineStatusOptions = [
    { value: "ongoing", label: "Ongoing" },
    { value: "closed", label: "Closed" },
    { value: "dropped", label: "Dropped" }
  ];

  initialize();

  async function initialize() {
    bindEvents();
    await hydrateSession();
    render();
  }

  function bindEvents() {
    document.addEventListener("submit", onSubmit);
    document.addEventListener("click", onClick);
    document.addEventListener("change", onChange);
    document.addEventListener("input", onInput);
  }

  async function hydrateSession() {
    try {
      const me = await api("/api/me");
      state.user = me.user;
      await refreshAllData();
    } catch (_err) {
      state.user = null;
    }
  }

  async function refreshAllData() {
    if (!state.user) {
      return;
    }
    const [usersRes, pipelineRes, mandatesRes] = await Promise.all([
      api("/api/users"),
      api("/api/pipeline" + (state.user.role === "admin" ? "?all=1" : "")),
      api("/api/mandates")
    ]);
    state.users = usersRes.users || [];
    state.pipeline = pipelineRes.pipeline || [];
    state.mandates = mandatesRes.signedMandates || [];
  }

  function defaultContacts() {
    return [
      { name: "", email: "", mobile: "" },
      { name: "", email: "", mobile: "" }
    ];
  }

  function defaultTracks() {
    return [];
  }

  function defaultPipelineForm() {
    return {
      companyName: "",
      requirementType: "debt",
      shortNote: "",
      referralSource: "",
      status: "ongoing",
      currentStatus: "",
      nextStep: "",
      ownerId: "",
      contacts: defaultContacts()
    };
  }

  function defaultMandateForm() {
    return {
      clientName: "",
      mandateType: "debt",
      ancillaryType: "",
      fundraisingAmount: "",
      feePercentage: "",
      feeMandateAmount: "",
      referralSource: "",
      ownerId: "",
      contacts: defaultContacts(),
      tracks: defaultTracks()
    };
  }

  function defaultConvertForm() {
    return {
      clientName: "",
      mandateType: "debt",
      ancillaryType: "",
      fundraisingAmount: "",
      feePercentage: "",
      feeMandateAmount: "",
      referralSource: "",
      contacts: defaultContacts(),
      tracks: defaultTracks()
    };
  }

  function resetFlash() {
    state.flashError = "";
    state.flashSuccess = "";
  }

  function setFlashSuccess(message) {
    state.flashSuccess = message;
    state.flashError = "";
  }

  function setFlashError(message) {
    state.flashError = message;
    state.flashSuccess = "";
  }

  function shouldShowFundingFields(mandateType) {
    return String(mandateType || "").toLowerCase() !== "ancillary";
  }

  function render() {
    if (!state.user) {
      renderLogin();
      return;
    }
    renderDashboard();
  }

  function renderLogin() {
    app.innerHTML = `
      <div class="container">
        <div class="card login-card stack">
          <h1>Mandate & Pipeline CRM</h1>
          <p class="subtle">Team login for signed mandates and live pipeline tracking.</p>
          <form id="login-form" class="stack">
            <label>Email
              <input type="email" name="email" placeholder="you@company.com" required />
            </label>
            <label>Password
              <div class="input-inline">
                <input id="login-password" type="password" name="password" placeholder="Password" required />
                <button type="button" class="btn-secondary btn-inline" data-action="toggle-password" data-target-id="login-password">View</button>
              </div>
            </label>
            <button class="btn-primary" type="submit">Sign In</button>
          </form>
          <div class="login-hint subtle">
            Use the admin credentials configured for your company deployment.
          </div>
          ${flashMarkup()}
        </div>
      </div>
    `;
  }

  function renderDashboard() {
    const tabs = [
      { key: "pipeline", label: "Pipeline" },
      { key: "mandates", label: "Signed Mandates" }
    ];
    if (state.user.role === "admin") {
      tabs.push({ key: "admin", label: "Admin View" });
    }

    app.innerHTML = `
      <div class="container">
        <div class="header">
          <div class="stack">
            <h1>Mandate & Pipeline CRM</h1>
            <div class="subtle">${escapeHtml(state.user.fullName)} (${escapeHtml(state.user.role)})</div>
          </div>
          <div class="inline-actions">
            <button class="btn-secondary" data-action="refresh">Refresh</button>
            <button class="btn-danger" data-action="logout">Logout</button>
          </div>
        </div>
        <div class="tabs">
          ${tabs
            .map(
              (tab) => `
                <button class="tab ${state.tab === tab.key ? "active" : ""}" data-action="tab" data-tab="${tab.key}">
                  ${tab.label}
                </button>
              `
            )
            .join("")}
        </div>
        ${flashMarkup()}
        ${state.tab === "pipeline" ? renderPipelineTab() : ""}
        ${state.tab === "mandates" ? renderMandatesTab() : ""}
        ${state.tab === "admin" ? renderAdminTab() : ""}
      </div>
    `;
    updatePasswordStrengthHint();
  }

  function flashMarkup() {
    return `
      ${state.flashError ? `<div class="error">${escapeHtml(state.flashError)}</div>` : ""}
      ${state.flashSuccess ? `<div class="success">${escapeHtml(state.flashSuccess)}</div>` : ""}
    `;
  }

  function renderPipelineTab() {
    const sorted = state.pipeline.slice().sort((a, b) => b.id - a.id);
    const list =
      state.user.role === "admin"
        ? sorted.filter((item) => {
            const typeOk =
              !state.pipelineFilters.requirementType ||
              item.requirementType === state.pipelineFilters.requirementType;
            const ownerOk =
              !state.pipelineFilters.ownerId || item.ownerId === Number(state.pipelineFilters.ownerId);
            return typeOk && ownerOk;
          })
        : sorted;
    const noPipelineMessage =
      state.user.role === "admin" &&
      (state.pipelineFilters.requirementType || state.pipelineFilters.ownerId)
        ? "No pipeline entries found for selected filters."
        : "No pipeline entries yet.";
    return `
      <div class="grid-main">
        <section class="card panel">
          <div class="section-head">
            <h2>${state.pipelineEditId ? "Edit Pipeline Entry" : "New Pipeline Entry"}</h2>
            ${
              state.pipelineEditId
                ? '<button class="btn-secondary btn-inline" data-action="reset-pipeline-form">Cancel Edit</button>'
                : ""
            }
          </div>
          <form id="pipeline-form" class="stack form-layout">
            <div class="row cols-2">
              <label>Company Name
                <input type="text" name="companyName" value="${escapeAttr(state.pipelineForm.companyName)}" required />
              </label>
              <label>Requirement Type
                <select name="requirementType">
                  ${mandateTypeOptions
                    .map((option) => optionMarkup(option.value, option.label, state.pipelineForm.requirementType))
                    .join("")}
                </select>
              </label>
            </div>
            <div class="row cols-2">
              <label>Referral Source
                <input type="text" name="referralSource" value="${escapeAttr(state.pipelineForm.referralSource)}" />
              </label>
              <label>Status
                <select name="status">
                  ${pipelineStatusOptions
                    .map((option) => optionMarkup(option.value, option.label, state.pipelineForm.status))
                    .join("")}
                </select>
              </label>
            </div>
            <div class="row cols-2">
              <label>Current Status
                <input type="text" name="currentStatus" value="${escapeAttr(state.pipelineForm.currentStatus)}" required />
              </label>
              <label>Next Step
                <input type="text" name="nextStep" value="${escapeAttr(state.pipelineForm.nextStep)}" required />
              </label>
            </div>
            ${
              state.user.role === "admin"
                ? `
                    <label>Employee Owner
                      <select name="ownerId">
                        <option value="">Select employee</option>
                        ${state.users
                          .map((u) =>
                            optionMarkup(
                              String(u.id),
                              `${u.fullName} (${u.role})`,
                              String(state.pipelineForm.ownerId || "")
                            )
                          )
                          .join("")}
                      </select>
                    </label>
                  `
                : ""
            }
            <label>Short Note on Requirement
              <textarea name="shortNote">${escapeHtml(state.pipelineForm.shortNote)}</textarea>
            </label>
            <div>
              <div class="section-head">
                <h3>Contacts (minimum 2)</h3>
                <button type="button" class="btn-secondary btn-inline" data-action="add-contact" data-target="pipeline">Add Contact</button>
              </div>
              ${renderContacts(state.pipelineForm.contacts, "pipeline")}
            </div>
            <button class="btn-primary" type="submit">${state.pipelineEditId ? "Update Entry" : "Create Entry"}</button>
          </form>
        </section>

        <section class="card panel">
          <div class="section-head">
            <h2>Pipeline Tracker</h2>
            <span class="subtle">${list.length} records</span>
          </div>
          ${
            state.user.role === "admin"
              ? `
                  <div class="row cols-2">
                    <label>Filter by Mandate Type
                      <select data-pipeline-filter="requirementType">
                        <option value="">All</option>
                        ${mandateTypeOptions
                          .map((opt) =>
                            optionMarkup(opt.value, opt.label, state.pipelineFilters.requirementType)
                          )
                          .join("")}
                      </select>
                    </label>
                    <label>Filter by Employee
                      <select data-pipeline-filter="ownerId">
                        <option value="">All employees</option>
                        ${state.users
                          .map((u) => optionMarkup(String(u.id), u.fullName, state.pipelineFilters.ownerId))
                          .join("")}
                      </select>
                    </label>
                  </div>
                `
              : ""
          }
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Company</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Current / Next</th>
                  <th>Referral</th>
                  <th>Owner</th>
                  <th>Dates</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${
                  list.length
                    ? list.map((item, index) => renderPipelineRow(item, index)).join("")
                    : `<tr><td colspan="9" class="subtle">${escapeHtml(noPipelineMessage)}</td></tr>`
                }
              </tbody>
            </table>
          </div>
          ${state.convertPipelineId ? renderConvertPanel() : ""}
        </section>
      </div>
    `;
  }

  function renderPipelineRow(item, index) {
    const owner = state.users.find((u) => u.id === item.ownerId);
    const statusClass =
      item.status === "ongoing"
        ? "ok"
        : item.status === "moved_to_signed"
          ? "warn"
          : item.status === "dropped"
            ? "danger"
            : "";
    const canConvert = item.status !== "moved_to_signed";
    return `
      <tr>
        <td>${index + 1}</td>
        <td>
          <strong>${escapeHtml(item.companyName)}</strong><br />
          <span class="subtle">${renderContactSummary(item.contacts)}</span>
        </td>
        <td>${escapeHtml(cap(item.requirementType))}</td>
        <td><span class="chip ${statusClass}">${escapeHtml(formatPipelineStatus(item.status))}</span></td>
        <td>${escapeHtml(item.currentStatus)}<br /><span class="subtle">${escapeHtml(item.nextStep)}</span></td>
        <td>${escapeHtml(item.referralSource || "-")}</td>
        <td>${escapeHtml(owner ? owner.fullName : "-")}</td>
        <td>${renderDateMeta(item)}</td>
        <td>
          <div class="inline-actions">
            <button type="button" class="btn-secondary btn-inline" data-action="edit-pipeline" data-id="${item.id}">Edit</button>
            <button type="button" class="btn-danger btn-inline" data-action="delete-pipeline" data-id="${item.id}">Delete</button>
            ${
              canConvert
                ? `<button type="button" class="btn-primary btn-inline" data-action="open-convert" data-id="${item.id}">Move to Signed</button>`
                : `<span class="chip warn">Converted</span>`
            }
          </div>
        </td>
      </tr>
    `;
  }

  function renderConvertPanel() {
    const item = state.pipeline.find((p) => Number(p.id) === Number(state.convertPipelineId));
    if (!item) {
      return "";
    }
    const form = state.convertForm;
    const showFundingFields = shouldShowFundingFields(form.mandateType);
    return `
      <div class="muted-box stack" style="margin-top:12px;">
        <div class="section-head">
          <h3>Convert: ${escapeHtml(item.companyName)} to Signed Mandate</h3>
          <button class="btn-secondary btn-inline" data-action="cancel-convert">Cancel</button>
        </div>
        <form id="convert-form" class="stack form-layout">
          <div class="row cols-3">
            <label>Client Name
              <input name="clientName" value="${escapeAttr(form.clientName)}" required />
            </label>
            <label>Mandate Type
              <select name="mandateType">
                ${mandateTypeOptions.map((opt) => optionMarkup(opt.value, opt.label, form.mandateType)).join("")}
              </select>
            </label>
            <label>Referral Source
              <input name="referralSource" value="${escapeAttr(form.referralSource)}" />
            </label>
          </div>
          ${
            form.mandateType === "ancillary"
              ? `
                <div class="row cols-2">
                  <label>Type of Ancillary
                    <input name="ancillaryType" value="${escapeAttr(form.ancillaryType)}" required />
                  </label>
                  <label>Fee Mandate Amount
                    <input name="feeMandateAmount" type="number" min="0" step="0.01" value="${escapeAttr(form.feeMandateAmount)}" required />
                  </label>
                </div>
              `
              : `
                <div class="row cols-3">
                  <label>Fundraising Amount
                    <input name="fundraisingAmount" type="number" min="0" step="0.01" value="${escapeAttr(form.fundraisingAmount)}" required />
                  </label>
                  <label>Fee Percentage
                    <input name="feePercentage" type="number" min="0" step="0.01" value="${escapeAttr(form.feePercentage)}" required />
                  </label>
                  <label>Fee Mandate Amount
                    <input name="feeMandateAmount" type="number" min="0" step="0.01" value="${escapeAttr(form.feeMandateAmount)}" required />
                  </label>
                </div>
              `
          }
          ${
            showFundingFields
              ? ""
              : '<div class="subtle">For ancillary mandates, fundraising and fee % are not required.</div>'
          }
          <div>
            <div class="section-head">
              <h3>Contacts (minimum 2)</h3>
              <button type="button" class="btn-secondary btn-inline" data-action="add-contact" data-target="convert">Add Contact</button>
            </div>
            ${renderContacts(form.contacts, "convert")}
          </div>
          <div>
            <div class="section-head">
              <h3>Bank/Investor Status Rows (optional)</h3>
              <button type="button" class="btn-secondary btn-inline" data-action="add-track" data-target="convert">Add Row</button>
            </div>
            ${renderTracks(form.tracks, "convert")}
          </div>
          <button class="btn-primary" type="submit">Convert to Signed Mandate</button>
        </form>
      </div>
    `;
  }

  function renderMandatesTab() {
    const list = state.mandates.slice().sort((a, b) => b.id - a.id);
    const showFundingFields = shouldShowFundingFields(state.mandateForm.mandateType);
    return `
      <div class="grid-main">
        <section class="card panel">
          <div class="section-head">
            <h2>${state.mandateEditId ? "Edit Signed Mandate" : "New Signed Mandate"}</h2>
            ${
              state.mandateEditId
                ? '<button class="btn-secondary btn-inline" data-action="reset-mandate-form">Cancel Edit</button>'
                : ""
            }
          </div>
          <form id="mandate-form" class="stack form-layout">
            <div class="row cols-3">
              <label>Client Name
                <input type="text" name="clientName" value="${escapeAttr(state.mandateForm.clientName)}" required />
              </label>
              <label>Mandate Type
                <select name="mandateType">
                  ${mandateTypeOptions
                    .map((opt) => optionMarkup(opt.value, opt.label, state.mandateForm.mandateType))
                    .join("")}
                </select>
              </label>
              <label>Referral Source
                <input name="referralSource" value="${escapeAttr(state.mandateForm.referralSource)}" />
              </label>
            </div>
            ${
              state.mandateForm.mandateType === "ancillary"
                ? `
                  <div class="row cols-2">
                    <label>Type of Ancillary
                      <input name="ancillaryType" value="${escapeAttr(state.mandateForm.ancillaryType)}" required />
                    </label>
                    <label>Fee Mandate Amount
                      <input type="number" min="0" step="0.01" name="feeMandateAmount" value="${escapeAttr(state.mandateForm.feeMandateAmount)}" required />
                    </label>
                  </div>
                `
                : `
                  <div class="row cols-3">
                    <label>Fundraising Amount
                      <input type="number" min="0" step="0.01" name="fundraisingAmount" value="${escapeAttr(state.mandateForm.fundraisingAmount)}" required />
                    </label>
                    <label>Fee Percentage
                      <input type="number" min="0" step="0.01" name="feePercentage" value="${escapeAttr(state.mandateForm.feePercentage)}" required />
                    </label>
                    <label>Fee Mandate Amount
                      <input type="number" min="0" step="0.01" name="feeMandateAmount" value="${escapeAttr(state.mandateForm.feeMandateAmount)}" required />
                    </label>
                  </div>
                `
            }
            ${
              showFundingFields
                ? ""
                : '<div class="subtle">Ancillary mandates only need fee mandate amount (plus ancillary type).</div>'
            }
            ${
              state.user.role === "admin"
                ? `
                  <label>Employee Owner
                    <select name="ownerId">
                      <option value="">Select employee</option>
                      ${state.users
                        .map((u) =>
                          optionMarkup(
                            String(u.id),
                            `${u.fullName} (${u.role})`,
                            String(state.mandateForm.ownerId || "")
                          )
                        )
                        .join("")}
                    </select>
                  </label>
                `
                : ""
            }
            <div>
              <div class="section-head">
                <h3>Contacts (minimum 2)</h3>
                <button type="button" class="btn-secondary btn-inline" data-action="add-contact" data-target="mandate">Add Contact</button>
              </div>
              ${renderContacts(state.mandateForm.contacts, "mandate")}
            </div>
            <div>
              <div class="section-head">
                <h3>Current Status by Bank / Investor (optional)</h3>
                <button type="button" class="btn-secondary btn-inline" data-action="add-track" data-target="mandate">Add Row</button>
              </div>
              ${renderTracks(state.mandateForm.tracks, "mandate")}
            </div>
            <button class="btn-primary" type="submit">${state.mandateEditId ? "Update Mandate" : "Create Mandate"}</button>
          </form>
        </section>

        <section class="card panel">
          <div class="section-head">
            <h2>Signed Mandates</h2>
            <span class="subtle">${list.length} mandates</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Client</th>
                  <th>Type</th>
                  <th>Fundraise</th>
                  <th>Fee %</th>
                  <th>Fee Mandate</th>
                  <th>Referral</th>
                  <th>Bank/Investor Status</th>
                  <th>Owner</th>
                  <th>Dates</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${
                  list.length
                    ? list.map((item, index) => renderMandateRow(item, index)).join("")
                    : '<tr><td colspan="11" class="subtle">No signed mandates yet.</td></tr>'
                }
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;
  }

  function renderMandateRow(item, index) {
    const owner = state.users.find((u) => u.id === item.ownerId);
    const typeLabel =
      item.mandateType === "ancillary" && item.ancillaryType
        ? `${cap(item.mandateType)} (${item.ancillaryType})`
        : cap(item.mandateType);
    const fundingText = shouldShowFundingFields(item.mandateType)
      ? formatMoney(item.fundraisingAmount)
      : "-";
    const feePctText = shouldShowFundingFields(item.mandateType)
      ? `${Number(item.feePercentage || 0)}%`
      : "-";
    return `
      <tr>
        <td>${index + 1}</td>
        <td>
          <strong>${escapeHtml(item.clientName)}</strong><br />
          <span class="subtle">${renderContactSummary(item.contacts)}</span>
        </td>
        <td>${escapeHtml(typeLabel)}</td>
        <td>${escapeHtml(fundingText)}</td>
        <td>${escapeHtml(feePctText)}</td>
        <td>${escapeHtml(formatMoney(item.feeMandateAmount))}</td>
        <td>${escapeHtml(item.referralSource || "-")}</td>
        <td>${renderTrackSummary(item.tracks)}</td>
        <td>${escapeHtml(owner ? owner.fullName : "-")}</td>
        <td>${renderDateMeta(item)}</td>
        <td>
          <div class="inline-actions">
            <button type="button" class="btn-secondary btn-inline" data-action="edit-mandate" data-id="${item.id}">Edit</button>
            <button type="button" class="btn-danger btn-inline" data-action="delete-mandate" data-id="${item.id}">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }

  function renderAdminTab() {
    const filteredMandates = state.mandates.filter((m) => {
      const typeOk = !state.adminFilters.mandateType || m.mandateType === state.adminFilters.mandateType;
      const ownerOk = !state.adminFilters.ownerId || m.ownerId === Number(state.adminFilters.ownerId);
      return typeOk && ownerOk;
    });

    const total = filteredMandates.length;
    const debt = filteredMandates.filter((m) => m.mandateType === "debt").length;
    const equity = filteredMandates.filter((m) => m.mandateType === "equity").length;
    const ancillary = filteredMandates.filter((m) => m.mandateType === "ancillary").length;

    const countByOwner = state.users
      .map((u) => ({
        ...u,
        clients: state.mandates.filter((m) => m.ownerId === u.id).length
      }))
      .sort((a, b) => b.clients - a.clients || a.fullName.localeCompare(b.fullName));

    return `
      <div class="stack">
        <section class="card panel stack">
          <div class="section-head">
            <h2>Consolidated Signed Mandates</h2>
          </div>
          <div class="row cols-3">
            <label>Filter by Mandate Type
              <select data-filter="mandateType">
                <option value="">All</option>
                ${mandateTypeOptions
                  .map((opt) => optionMarkup(opt.value, opt.label, state.adminFilters.mandateType))
                  .join("")}
              </select>
            </label>
            <label>Filter by Employee
              <select data-filter="ownerId">
                <option value="">All employees</option>
                ${state.users.map((u) => optionMarkup(String(u.id), u.fullName, state.adminFilters.ownerId)).join("")}
              </select>
            </label>
            <div class="stats">
              <div class="stat">
                <div class="subtle">Total</div>
                <div class="stat-value">${total}</div>
              </div>
              <div class="stat">
                <div class="subtle">Debt</div>
                <div class="stat-value">${debt}</div>
              </div>
              <div class="stat">
                <div class="subtle">Equity</div>
                <div class="stat-value">${equity}</div>
              </div>
              <div class="stat">
                <div class="subtle">Ancillary</div>
                <div class="stat-value">${ancillary}</div>
              </div>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Client</th>
                  <th>Type</th>
                  <th>Fundraise</th>
                  <th>Owner</th>
                  <th>Fee %</th>
                  <th>Fee Mandate</th>
                  <th>Referral</th>
                  <th>Dates</th>
                </tr>
              </thead>
              <tbody>
                ${
                  filteredMandates.length
                    ? filteredMandates
                        .map((item, index) => {
                          const owner = state.users.find((u) => u.id === item.ownerId);
                          const showFunding = shouldShowFundingFields(item.mandateType);
                          const typeLabel =
                            item.mandateType === "ancillary" && item.ancillaryType
                              ? `${cap(item.mandateType)} (${item.ancillaryType})`
                              : cap(item.mandateType);
                          return `
                            <tr>
                              <td>${index + 1}</td>
                              <td>${escapeHtml(item.clientName)}</td>
                              <td>${escapeHtml(typeLabel)}</td>
                              <td>${escapeHtml(showFunding ? formatMoney(item.fundraisingAmount) : "-")}</td>
                              <td>${escapeHtml(owner ? owner.fullName : "-")}</td>
                              <td>${escapeHtml(showFunding ? `${Number(item.feePercentage || 0)}%` : "-")}</td>
                              <td>${escapeHtml(formatMoney(item.feeMandateAmount))}</td>
                              <td>${escapeHtml(item.referralSource || "-")}</td>
                              <td>${renderDateMeta(item)}</td>
                            </tr>
                          `;
                        })
                        .join("")
                    : '<tr><td colspan="9" class="subtle">No mandates found for selected filters.</td></tr>'
                }
              </tbody>
            </table>
          </div>
        </section>

        <section class="card panel">
          <div class="section-head">
            <h2>Client Count by Employee</h2>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Employee</th>
                  <th>Role</th>
                  <th>Signed Clients</th>
                </tr>
              </thead>
              <tbody>
                ${countByOwner
                  .map(
                    (row, index) => `
                  <tr>
                    <td>${index + 1}</td>
                    <td>${escapeHtml(row.fullName)}</td>
                    <td>${escapeHtml(cap(row.role))}</td>
                    <td>${row.clients}</td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>

        <section class="card panel">
          <div class="section-head">
            <h2>Create Employee Login</h2>
          </div>
          <form id="user-form" class="row cols-4">
            <label>Full Name
              <input name="fullName" required />
            </label>
            <label>Email
              <input name="email" type="email" required />
            </label>
            <label>Password
              <div class="input-inline">
                <input id="new-user-password" name="password" data-role="new-user-password" type="password" required />
                <button type="button" class="btn-secondary btn-inline" data-action="toggle-password" data-target-id="new-user-password">View</button>
              </div>
            </label>
            <label>Role
              <select name="role">
                <option value="employee">Employee</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <div id="password-strength" class="subtle" style="grid-column:1 / -1;"></div>
            <button class="btn-primary" type="submit" style="grid-column:1 / -1;">Create User</button>
          </form>
          <div class="table-wrap" style="margin-top:12px;">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                ${state.users
                  .map(
                    (u) => `
                  <tr>
                    <td>${escapeHtml(u.fullName)}</td>
                    <td>${escapeHtml(u.email)}</td>
                    <td>${escapeHtml(cap(u.role))}</td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;
  }

  function renderContacts(contacts, target) {
    return contacts
      .map(
        (contact, index) => `
      <div class="contact-row">
        <div class="row cols-3">
          <label>Contact Person
            <input data-model="${target}" data-kind="contact" data-index="${index}" data-field="name" value="${escapeAttr(contact.name)}" required />
          </label>
          <label>Email
            <input type="email" data-model="${target}" data-kind="contact" data-index="${index}" data-field="email" value="${escapeAttr(contact.email)}" required />
          </label>
          <label>Mobile
            <input data-model="${target}" data-kind="contact" data-index="${index}" data-field="mobile" value="${escapeAttr(contact.mobile)}" required />
          </label>
        </div>
        <div class="inline-actions">
          <button type="button" class="btn-danger btn-inline" data-action="remove-contact" data-target="${target}" data-index="${index}">Remove</button>
        </div>
      </div>
    `
      )
      .join("");
  }

  function renderTracks(tracks, target) {
    if (!Array.isArray(tracks) || tracks.length === 0) {
      return '<div class="subtle">No bank/investor rows yet.</div>';
    }
    return tracks
      .map(
        (track, index) => `
      <div class="track-row">
        <div class="row cols-3">
          <label>Bank / Investor
            <input data-model="${target}" data-kind="track" data-index="${index}" data-field="institution" value="${escapeAttr(track.institution)}" />
          </label>
          <label>Current Status
            <input data-model="${target}" data-kind="track" data-index="${index}" data-field="currentStatus" value="${escapeAttr(track.currentStatus)}" />
          </label>
          <label>Next Step
            <input data-model="${target}" data-kind="track" data-index="${index}" data-field="nextStep" value="${escapeAttr(track.nextStep)}" />
          </label>
        </div>
        <div class="inline-actions">
          <button type="button" class="btn-danger btn-inline" data-action="remove-track" data-target="${target}" data-index="${index}">Remove</button>
        </div>
      </div>
    `
      )
      .join("");
  }

  async function onSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }

    if (form.id === "login-form") {
      event.preventDefault();
      await submitLogin(form);
      return;
    }

    if (form.id === "pipeline-form") {
      event.preventDefault();
      await submitPipeline(form);
      return;
    }

    if (form.id === "mandate-form") {
      event.preventDefault();
      await submitMandate(form);
      return;
    }

    if (form.id === "convert-form") {
      event.preventDefault();
      await submitConvert(form);
      return;
    }

    if (form.id === "user-form") {
      event.preventDefault();
      await submitCreateUser(form);
    }
  }

  async function submitLogin(form) {
    resetFlash();
    const fd = new FormData(form);
    try {
      const response = await api("/api/login", {
        method: "POST",
        body: {
          email: fd.get("email"),
          password: fd.get("password")
        }
      });
      state.user = response.user;
      state.tab = "pipeline";
      state.pipelineForm = defaultPipelineForm();
      state.mandateForm = defaultMandateForm();
      state.convertForm = defaultConvertForm();
      await refreshAllData();
      setFlashSuccess("Logged in successfully.");
    } catch (err) {
      setFlashError(err.message || "Login failed.");
    }
    render();
  }

  async function submitPipeline(form) {
    resetFlash();
    const fd = new FormData(form);
    state.pipelineForm.companyName = String(fd.get("companyName") || "").trim();
    state.pipelineForm.requirementType = String(fd.get("requirementType") || "debt");
    state.pipelineForm.referralSource = String(fd.get("referralSource") || "").trim();
    state.pipelineForm.status = String(fd.get("status") || "ongoing");
    state.pipelineForm.currentStatus = String(fd.get("currentStatus") || "").trim();
    state.pipelineForm.nextStep = String(fd.get("nextStep") || "").trim();
    state.pipelineForm.shortNote = String(fd.get("shortNote") || "").trim();
    state.pipelineForm.ownerId = String(fd.get("ownerId") || "");

    const payload = {
      ...state.pipelineForm,
      contacts: state.pipelineForm.contacts
    };

    try {
      if (state.pipelineEditId) {
        await api(`/api/pipeline/${state.pipelineEditId}`, {
          method: "PUT",
          body: payload
        });
        setFlashSuccess("Pipeline entry updated.");
      } else {
        await api("/api/pipeline", {
          method: "POST",
          body: payload
        });
        setFlashSuccess("Pipeline entry created.");
      }
      state.pipelineEditId = null;
      state.pipelineForm = defaultPipelineForm();
      await refreshAllData();
    } catch (err) {
      setFlashError(err.message || "Unable to save pipeline entry.");
    }
    render();
  }

  async function submitMandate(form) {
    resetFlash();
    const fd = new FormData(form);
    state.mandateForm.clientName = String(fd.get("clientName") || "").trim();
    state.mandateForm.mandateType = String(fd.get("mandateType") || "debt").trim().toLowerCase();
    state.mandateForm.ancillaryType = String(fd.get("ancillaryType") || "").trim();
    state.mandateForm.fundraisingAmount = String(fd.get("fundraisingAmount") || "").trim();
    state.mandateForm.feePercentage = String(fd.get("feePercentage") || "").trim();
    state.mandateForm.feeMandateAmount = String(fd.get("feeMandateAmount") || "").trim();
    state.mandateForm.referralSource = String(fd.get("referralSource") || "").trim();
    state.mandateForm.ownerId = String(fd.get("ownerId") || "");

    const payload = {
      ...state.mandateForm,
      contacts: state.mandateForm.contacts,
      tracks: state.mandateForm.tracks
    };

    if (state.mandateForm.mandateType === "ancillary") {
      payload.fundraisingAmount = "";
      payload.feePercentage = "";
    } else {
      payload.ancillaryType = "";
    }

    try {
      if (state.mandateEditId) {
        await api(`/api/mandates/${state.mandateEditId}`, {
          method: "PUT",
          body: payload
        });
        setFlashSuccess("Signed mandate updated.");
      } else {
        await api("/api/mandates", {
          method: "POST",
          body: payload
        });
        setFlashSuccess("Signed mandate created.");
      }
      state.mandateEditId = null;
      state.mandateForm = defaultMandateForm();
      await refreshAllData();
    } catch (err) {
      setFlashError(err.message || "Unable to save signed mandate.");
    }
    render();
  }

  async function submitConvert(form) {
    resetFlash();
    if (!state.convertPipelineId) {
      return;
    }

    const fd = new FormData(form);
    state.convertForm.clientName = String(fd.get("clientName") || "").trim();
    state.convertForm.mandateType = String(fd.get("mandateType") || "debt").trim().toLowerCase();
    state.convertForm.ancillaryType = String(fd.get("ancillaryType") || "").trim();
    state.convertForm.fundraisingAmount = String(fd.get("fundraisingAmount") || "").trim();
    state.convertForm.feePercentage = String(fd.get("feePercentage") || "").trim();
    state.convertForm.feeMandateAmount = String(fd.get("feeMandateAmount") || "").trim();
    state.convertForm.referralSource = String(fd.get("referralSource") || "").trim();

    const payload = {
      ...state.convertForm,
      contacts: state.convertForm.contacts,
      tracks: state.convertForm.tracks
    };
    if (state.convertForm.mandateType === "ancillary") {
      payload.fundraisingAmount = "";
      payload.feePercentage = "";
    } else {
      payload.ancillaryType = "";
    }

    try {
      await api(`/api/pipeline/${state.convertPipelineId}/convert`, {
        method: "POST",
        body: payload
      });
      state.convertPipelineId = null;
      state.convertForm = defaultConvertForm();
      await refreshAllData();
      setFlashSuccess("Pipeline moved to signed mandate successfully.");
    } catch (err) {
      setFlashError(err.message || "Unable to convert pipeline entry.");
    }
    render();
  }

  async function submitCreateUser(form) {
    resetFlash();
    const fd = new FormData(form);
    try {
      await api("/api/users", {
        method: "POST",
        body: {
          fullName: fd.get("fullName"),
          email: fd.get("email"),
          password: fd.get("password"),
          role: fd.get("role")
        }
      });
      await refreshAllData();
      setFlashSuccess("User created.");
      form.reset();
    } catch (err) {
      setFlashError(err.message || "Unable to create user.");
    }
    render();
  }

  async function onClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const actionEl = target.closest("[data-action]");
    if (!actionEl) {
      return;
    }
    const action = actionEl.getAttribute("data-action");
    if (!action) {
      return;
    }

    if (!["logout", "refresh", "tab", "toggle-password"].includes(action)) {
      captureVisibleFormDrafts();
    }

    if (action === "toggle-password") {
      const targetId = actionEl.getAttribute("data-target-id");
      if (!targetId) {
        return;
      }
      const input = document.getElementById(targetId);
      if (input instanceof HTMLInputElement) {
        input.type = input.type === "password" ? "text" : "password";
        actionEl.textContent = input.type === "password" ? "View" : "Hide";
      }
      return;
    }

    if (action === "logout") {
      resetFlash();
      await api("/api/logout", { method: "POST" }).catch(() => null);
      state.user = null;
      state.users = [];
      state.pipeline = [];
      state.mandates = [];
      setFlashSuccess("Logged out.");
      render();
      return;
    }

    if (action === "refresh") {
      resetFlash();
      try {
        await refreshAllData();
        setFlashSuccess("Data refreshed.");
      } catch (err) {
        setFlashError(err.message || "Refresh failed.");
      }
      render();
      return;
    }

    if (action === "tab") {
      resetFlash();
      state.tab = actionEl.getAttribute("data-tab") || "pipeline";
      render();
      return;
    }

    if (action === "reset-pipeline-form") {
      state.pipelineEditId = null;
      state.pipelineForm = defaultPipelineForm();
      render();
      return;
    }

    if (action === "reset-mandate-form") {
      state.mandateEditId = null;
      state.mandateForm = defaultMandateForm();
      render();
      return;
    }

    if (action === "edit-pipeline") {
      const id = Number(actionEl.getAttribute("data-id"));
      const item = state.pipeline.find((p) => Number(p.id) === Number(id));
      if (!item) {
        return;
      }
      state.pipelineEditId = id;
      state.pipelineForm = {
        companyName: item.companyName || "",
        requirementType: item.requirementType || "debt",
        shortNote: item.shortNote || "",
        referralSource: item.referralSource || "",
        status: item.status === "moved_to_signed" ? "ongoing" : item.status || "ongoing",
        currentStatus: item.currentStatus || "",
        nextStep: item.nextStep || "",
        ownerId: String(item.ownerId || ""),
        contacts: cloneArray(item.contacts, defaultContacts())
      };
      state.tab = "pipeline";
      setFlashSuccess("Pipeline entry loaded for edit.");
      render();
      focusForm("#pipeline-form");
      return;
    }

    if (action === "edit-mandate") {
      const id = Number(actionEl.getAttribute("data-id"));
      const item = state.mandates.find((m) => Number(m.id) === Number(id));
      if (!item) {
        return;
      }
      state.mandateEditId = id;
      state.mandateForm = {
        clientName: item.clientName || "",
        mandateType: item.mandateType || "debt",
        ancillaryType: item.ancillaryType || "",
        fundraisingAmount: String(item.fundraisingAmount ?? ""),
        feePercentage: String(item.feePercentage ?? ""),
        feeMandateAmount: String(item.feeMandateAmount ?? ""),
        referralSource: item.referralSource || "",
        ownerId: String(item.ownerId || ""),
        contacts: cloneArray(item.contacts, defaultContacts()),
        tracks: cloneArray(item.tracks, defaultTracks())
      };
      state.tab = "mandates";
      setFlashSuccess("Signed mandate loaded for edit.");
      render();
      focusForm("#mandate-form");
      return;
    }

    if (action === "delete-pipeline") {
      const id = Number(actionEl.getAttribute("data-id"));
      if (!id) {
        return;
      }
      if (!window.confirm("Delete this pipeline record?")) {
        return;
      }
      resetFlash();
      try {
        await api(`/api/pipeline/${id}`, { method: "DELETE" });
        await refreshAllData();
        setFlashSuccess("Pipeline record deleted.");
      } catch (err) {
        setFlashError(err.message || "Unable to delete pipeline record.");
      }
      render();
      return;
    }

    if (action === "delete-mandate") {
      const id = Number(actionEl.getAttribute("data-id"));
      if (!id) {
        return;
      }
      if (!window.confirm("Delete this signed mandate record?")) {
        return;
      }
      resetFlash();
      try {
        await api(`/api/mandates/${id}`, { method: "DELETE" });
        await refreshAllData();
        setFlashSuccess("Signed mandate deleted.");
      } catch (err) {
        setFlashError(err.message || "Unable to delete signed mandate.");
      }
      render();
      return;
    }

    if (action === "open-convert") {
      const id = Number(actionEl.getAttribute("data-id"));
      const item = state.pipeline.find((p) => Number(p.id) === Number(id));
      if (!item) {
        return;
      }
      state.convertPipelineId = id;
      state.convertForm = {
        clientName: item.companyName || "",
        mandateType: item.requirementType || "debt",
        ancillaryType: "",
        fundraisingAmount: "",
        feePercentage: "",
        feeMandateAmount: "",
        referralSource: item.referralSource || "",
        contacts: cloneArray(item.contacts, defaultContacts()),
        tracks: defaultTracks()
      };
      state.tab = "pipeline";
      render();
      return;
    }

    if (action === "cancel-convert") {
      state.convertPipelineId = null;
      state.convertForm = defaultConvertForm();
      render();
      return;
    }

    if (action === "add-contact") {
      const targetModel = actionEl.getAttribute("data-target");
      const model = getFormByTarget(targetModel);
      if (!model) {
        return;
      }
      model.contacts.push({ name: "", email: "", mobile: "" });
      render();
      return;
    }

    if (action === "remove-contact") {
      const targetModel = actionEl.getAttribute("data-target");
      const index = Number(actionEl.getAttribute("data-index"));
      const model = getFormByTarget(targetModel);
      if (!model || !Array.isArray(model.contacts)) {
        return;
      }
      if (model.contacts.length <= 2) {
        setFlashError("At least 2 contacts are required.");
        render();
        return;
      }
      model.contacts.splice(index, 1);
      resetFlash();
      render();
      return;
    }

    if (action === "add-track") {
      const targetModel = actionEl.getAttribute("data-target");
      const model = getFormByTarget(targetModel);
      if (!model || !Array.isArray(model.tracks)) {
        return;
      }
      model.tracks.push({ institution: "", currentStatus: "", nextStep: "" });
      render();
      return;
    }

    if (action === "remove-track") {
      const targetModel = actionEl.getAttribute("data-target");
      const index = Number(actionEl.getAttribute("data-index"));
      const model = getFormByTarget(targetModel);
      if (!model || !Array.isArray(model.tracks)) {
        return;
      }
      model.tracks.splice(index, 1);
      resetFlash();
      render();
    }
  }

  function onChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.matches("select[data-pipeline-filter]")) {
      const key = target.getAttribute("data-pipeline-filter");
      if (!key) {
        return;
      }
      state.pipelineFilters[key] = target.value;
      render();
      return;
    }

    if (target.matches("select[data-filter]")) {
      const key = target.getAttribute("data-filter");
      if (!key) {
        return;
      }
      state.adminFilters[key] = target.value;
      render();
      return;
    }

    if (target instanceof HTMLSelectElement && target.name === "mandateType") {
      captureVisibleFormDrafts();
      if (target.closest("#mandate-form")) {
        state.mandateForm.mandateType = target.value;
        render();
        return;
      }
      if (target.closest("#convert-form")) {
        state.convertForm.mandateType = target.value;
        render();
      }
    }
  }

  function onInput(event) {
    const input = event.target;
    if (!(input instanceof HTMLElement)) {
      return;
    }

    if (input instanceof HTMLInputElement && input.dataset.role === "new-user-password") {
      updatePasswordStrengthHint(input.value);
      return;
    }

    const modelKey = input.getAttribute("data-model");
    const kind = input.getAttribute("data-kind");
    const index = Number(input.getAttribute("data-index"));
    const field = input.getAttribute("data-field");
    if (!modelKey || !kind || Number.isNaN(index) || !field) {
      return;
    }
    const model = getFormByTarget(modelKey);
    if (!model) {
      return;
    }
    if (kind === "contact" && model.contacts[index]) {
      model.contacts[index][field] = input.value;
      return;
    }
    if (kind === "track" && model.tracks[index]) {
      model.tracks[index][field] = input.value;
    }
  }

  function getFormByTarget(target) {
    if (target === "pipeline") {
      return state.pipelineForm;
    }
    if (target === "mandate") {
      return state.mandateForm;
    }
    if (target === "convert") {
      return state.convertForm;
    }
    return null;
  }

  function captureVisibleFormDrafts() {
    const pipelineForm = document.getElementById("pipeline-form");
    if (pipelineForm instanceof HTMLFormElement) {
      const fd = new FormData(pipelineForm);
      state.pipelineForm.companyName = String(fd.get("companyName") || "").trim();
      state.pipelineForm.requirementType = String(fd.get("requirementType") || "debt");
      state.pipelineForm.referralSource = String(fd.get("referralSource") || "").trim();
      state.pipelineForm.status = String(fd.get("status") || "ongoing");
      state.pipelineForm.currentStatus = String(fd.get("currentStatus") || "").trim();
      state.pipelineForm.nextStep = String(fd.get("nextStep") || "").trim();
      state.pipelineForm.shortNote = String(fd.get("shortNote") || "").trim();
      state.pipelineForm.ownerId = String(fd.get("ownerId") || "");
    }

    const mandateForm = document.getElementById("mandate-form");
    if (mandateForm instanceof HTMLFormElement) {
      const fd = new FormData(mandateForm);
      state.mandateForm.clientName = String(fd.get("clientName") || "").trim();
      state.mandateForm.mandateType = String(fd.get("mandateType") || "debt").trim().toLowerCase();
      state.mandateForm.ancillaryType = String(fd.get("ancillaryType") || "").trim();
      state.mandateForm.fundraisingAmount = String(fd.get("fundraisingAmount") || "").trim();
      state.mandateForm.feePercentage = String(fd.get("feePercentage") || "").trim();
      state.mandateForm.feeMandateAmount = String(fd.get("feeMandateAmount") || "").trim();
      state.mandateForm.referralSource = String(fd.get("referralSource") || "").trim();
      state.mandateForm.ownerId = String(fd.get("ownerId") || "");
    }

    const convertForm = document.getElementById("convert-form");
    if (convertForm instanceof HTMLFormElement) {
      const fd = new FormData(convertForm);
      state.convertForm.clientName = String(fd.get("clientName") || "").trim();
      state.convertForm.mandateType = String(fd.get("mandateType") || "debt").trim().toLowerCase();
      state.convertForm.ancillaryType = String(fd.get("ancillaryType") || "").trim();
      state.convertForm.fundraisingAmount = String(fd.get("fundraisingAmount") || "").trim();
      state.convertForm.feePercentage = String(fd.get("feePercentage") || "").trim();
      state.convertForm.feeMandateAmount = String(fd.get("feeMandateAmount") || "").trim();
      state.convertForm.referralSource = String(fd.get("referralSource") || "").trim();
    }
  }

  function focusForm(selector) {
    const form = document.querySelector(selector);
    if (!(form instanceof HTMLElement)) {
      return;
    }
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    const firstInput = form.querySelector("input, select, textarea");
    if (firstInput instanceof HTMLElement) {
      window.setTimeout(() => firstInput.focus(), 120);
    }
  }

  function cloneArray(source, fallbackFactory) {
  if (Array.isArray(source) && source.length > 0) {
    return source.map((item) => ({ ...item }));
  }

  if (typeof fallbackFactory === "function") {
    return fallbackFactory();
  }

  if (Array.isArray(fallbackFactory)) {
    return fallbackFactory.map((item) => ({ ...item }));
  }

  return [];
}

  function optionMarkup(value, label, selectedValue) {
    const selected = String(value) === String(selectedValue) ? "selected" : "";
    return `<option value="${escapeAttr(String(value))}" ${selected}>${escapeHtml(label)}</option>`;
  }

  function renderContactSummary(contacts) {
    if (!Array.isArray(contacts) || contacts.length === 0) {
      return "-";
    }
    return contacts
      .slice(0, 2)
      .map((c) => `${c.name || "?"} (${c.email || "-"})`)
      .join(" | ");
  }

  function renderTrackSummary(tracks) {
    if (!Array.isArray(tracks) || tracks.length === 0) {
      return '<span class="subtle">No rows</span>';
    }
    return tracks
      .map((track) => {
        const bank = track.institution ? escapeHtml(track.institution) : "Bank/Investor";
        const current = track.currentStatus ? escapeHtml(track.currentStatus) : "-";
        const next = track.nextStep ? escapeHtml(track.nextStep) : "-";
        return `
          <span class="badge-track">
            <strong>${bank}</strong><br />
            ${current} -> ${next}
          </span>
        `;
      })
      .join("");
  }

  function formatMoney(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return "-";
    }
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function formatPipelineStatus(status) {
    if (status === "moved_to_signed") {
      return "Moved to Signed";
    }
    return cap(status || "");
  }

  function formatDate(value) {
    if (!value) {
      return "-";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "-";
    }
    return date.toLocaleString();
  }

  function renderDateMeta(record) {
    const created = formatDate(record.createdAt);
    const updated = formatDate(record.updatedAt);
    const changeDates = extractChangeDates(record.changeLog);
    return `
      <span class="subtle">Created: ${escapeHtml(created)}</span><br />
      <span class="subtle">Updated: ${escapeHtml(updated)}</span>
      ${
        changeDates.length
          ? `<br /><span class="subtle">Changes: ${escapeHtml(changeDates.join(", "))}</span>`
          : ""
      }
    `;
  }

  function extractChangeDates(changeLog) {
    if (!Array.isArray(changeLog)) {
      return [];
    }
    const updates = changeLog
      .filter((entry) => entry && entry.action && entry.action !== "created")
      .map((entry) => formatDate(entry.at))
      .filter((value) => value !== "-");
    return updates.slice(-3);
  }

  function passwordStrengthState(password) {
    const text = String(password || "");
    const hasLength = text.length >= 8;
    const hasUpper = /[A-Z]/.test(text);
    const hasLower = /[a-z]/.test(text);
    const hasDigit = /\d/.test(text);
    const hasSpecial = /[^A-Za-z0-9]/.test(text);
    const ok = hasLength && hasUpper && hasLower && hasDigit && hasSpecial;
    if (!text) {
      return { ok: false, text: "Password needs 8+ chars, upper, lower, number, special." };
    }
    if (ok) {
      return { ok: true, text: "Strong password." };
    }
    return { ok: false, text: "Weak password: use 8+ chars, upper, lower, number, special." };
  }

  function updatePasswordStrengthHint(value) {
    const input = document.getElementById("new-user-password");
    const target = document.getElementById("password-strength");
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const strength = passwordStrengthState(value || (input instanceof HTMLInputElement ? input.value : ""));
    target.textContent = strength.text;
    target.className = strength.ok ? "success" : "subtle";
  }

  function cap(value) {
    const text = String(value || "");
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replaceAll("\n", " ");
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "same-origin",
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(payload.error || "Request failed.");
      err.status = response.status;
      throw err;
    }
    return payload;
  }
})();
