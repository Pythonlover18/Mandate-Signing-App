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
    return [{ institution: "", currentStatus: "", nextStep: "" }];
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
      fundraisingAmount: "",
      mandateType: "debt",
      debtEquityAmount: "",
      feePercentage: "",
      feeMandateAmount: "",
      ownerId: "",
      contacts: defaultContacts(),
      tracks: defaultTracks()
    };
  }

  function defaultConvertForm() {
    return {
      clientName: "",
      fundraisingAmount: "",
      mandateType: "debt",
      debtEquityAmount: "",
      feePercentage: "",
      feeMandateAmount: "",
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
              <input type="password" name="password" placeholder="Password" required />
            </label>
            <button class="btn-primary" type="submit">Sign In</button>
          </form>
          <div class="login-hint subtle">
            Default admin login:<br />
            <strong>Email:</strong> admin@crm.local<br />
            <strong>Password:</strong> admin123
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
  }

  function flashMarkup() {
    return `
      ${state.flashError ? `<div class="error">${escapeHtml(state.flashError)}</div>` : ""}
      ${state.flashSuccess ? `<div class="success">${escapeHtml(state.flashSuccess)}</div>` : ""}
    `;
  }

  function renderPipelineTab() {
    const filtered = state.pipeline.slice().sort((a, b) => b.id - a.id);
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
          <form id="pipeline-form" class="stack">
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
                    .map((u) => optionMarkup(String(u.id), `${u.fullName} (${u.role})`, String(state.pipelineForm.ownerId || "")))
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
            <span class="subtle">${filtered.length} records</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Current Status</th>
                  <th>Next Step</th>
                  <th>Referral</th>
                  <th>Owner</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${
                  filtered.length
                    ? filtered.map(renderPipelineRow).join("")
                    : '<tr><td colspan="8" class="subtle">No pipeline entries yet.</td></tr>'
                }
              </tbody>
            </table>
          </div>
          ${state.convertPipelineId ? renderConvertPanel() : ""}
        </section>
      </div>
    `;
  }

  function renderPipelineRow(item) {
    const owner = state.users.find((u) => u.id === item.ownerId);
    const statusClass =
      item.status === "ongoing" ? "ok" : item.status === "moved_to_signed" ? "warn" : item.status === "dropped" ? "danger" : "";
    const canConvert = item.status !== "moved_to_signed";
    return `
      <tr>
        <td>
          <strong>${escapeHtml(item.companyName)}</strong><br />
          <span class="subtle">${renderContactSummary(item.contacts)}</span>
        </td>
        <td>${escapeHtml(cap(item.requirementType))}</td>
        <td><span class="chip ${statusClass}">${escapeHtml(formatPipelineStatus(item.status))}</span></td>
        <td>${escapeHtml(item.currentStatus)}</td>
        <td>${escapeHtml(item.nextStep)}</td>
        <td>${escapeHtml(item.referralSource || "-")}</td>
        <td>${escapeHtml(owner ? owner.fullName : "-")}</td>
        <td>
          <div class="inline-actions">
            <button class="btn-secondary btn-inline" data-action="edit-pipeline" data-id="${item.id}">Edit</button>
            ${
              canConvert
                ? `<button class="btn-primary btn-inline" data-action="open-convert" data-id="${item.id}">Move to Signed</button>`
                : `<span class="chip warn">Converted</span>`
            }
          </div>
        </td>
      </tr>
    `;
  }

  function renderConvertPanel() {
    const item = state.pipeline.find((p) => p.id === state.convertPipelineId);
    if (!item) {
      return "";
    }
    const form = state.convertForm;
    return `
      <div class="muted-box stack" style="margin-top:12px;">
        <div class="section-head">
          <h3>Convert: ${escapeHtml(item.companyName)} to Signed Mandate</h3>
          <button class="btn-secondary btn-inline" data-action="cancel-convert">Cancel</button>
        </div>
        <form id="convert-form" class="stack">
          <div class="row cols-3">
            <label>Client Name
              <input name="clientName" value="${escapeAttr(form.clientName)}" required />
            </label>
            <label>Fundraising Amount
              <input name="fundraisingAmount" type="number" min="0" step="0.01" value="${escapeAttr(form.fundraisingAmount)}" required />
            </label>
            <label>Mandate Type
              <select name="mandateType">
                ${mandateTypeOptions.map((opt) => optionMarkup(opt.value, opt.label, form.mandateType)).join("")}
              </select>
            </label>
          </div>
          <div class="row cols-3">
            <label>Debt/Equity Amount
              <input name="debtEquityAmount" type="number" min="0" step="0.01" value="${escapeAttr(form.debtEquityAmount)}" />
            </label>
            <label>Fee Percentage
              <input name="feePercentage" type="number" min="0" step="0.01" value="${escapeAttr(form.feePercentage)}" required />
            </label>
            <label>Fee Mandate Amount
              <input name="feeMandateAmount" type="number" min="0" step="0.01" value="${escapeAttr(form.feeMandateAmount)}" required />
            </label>
          </div>
          <div>
            <div class="section-head">
              <h3>Contacts (minimum 2)</h3>
              <button type="button" class="btn-secondary btn-inline" data-action="add-contact" data-target="convert">Add Contact</button>
            </div>
            ${renderContacts(form.contacts, "convert")}
          </div>
          <div>
            <div class="section-head">
              <h3>Bank/Investor Status Rows</h3>
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
          <form id="mandate-form" class="stack">
            <div class="row cols-2">
              <label>Client Name
                <input type="text" name="clientName" value="${escapeAttr(state.mandateForm.clientName)}" required />
              </label>
              <label>Fundraising Amount
                <input type="number" min="0" step="0.01" name="fundraisingAmount" value="${escapeAttr(state.mandateForm.fundraisingAmount)}" required />
              </label>
            </div>
            <div class="row cols-3">
              <label>Mandate Type
                <select name="mandateType">
                  ${mandateTypeOptions
                    .map((opt) => optionMarkup(opt.value, opt.label, state.mandateForm.mandateType))
                    .join("")}
                </select>
              </label>
              <label>Debt/Equity Amount
                <input type="number" min="0" step="0.01" name="debtEquityAmount" value="${escapeAttr(state.mandateForm.debtEquityAmount)}" />
              </label>
              <label>Fee Percentage
                <input type="number" min="0" step="0.01" name="feePercentage" value="${escapeAttr(state.mandateForm.feePercentage)}" required />
              </label>
            </div>
            <div class="row cols-2">
              <label>Fee Mandate Amount
                <input type="number" min="0" step="0.01" name="feeMandateAmount" value="${escapeAttr(state.mandateForm.feeMandateAmount)}" required />
              </label>
              ${
                state.user.role === "admin"
                  ? `
                <label>Employee Owner
                  <select name="ownerId">
                    <option value="">Select employee</option>
                    ${state.users
                      .map((u) => optionMarkup(String(u.id), `${u.fullName} (${u.role})`, String(state.mandateForm.ownerId || "")))
                      .join("")}
                  </select>
                </label>
              `
                  : '<div></div>'
              }
            </div>
            <div>
              <div class="section-head">
                <h3>Contacts (minimum 2)</h3>
                <button type="button" class="btn-secondary btn-inline" data-action="add-contact" data-target="mandate">Add Contact</button>
              </div>
              ${renderContacts(state.mandateForm.contacts, "mandate")}
            </div>
            <div>
              <div class="section-head">
                <h3>Current Status by Bank / Investor</h3>
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
                  <th>Client</th>
                  <th>Type</th>
                  <th>Fundraise</th>
                  <th>Fee %</th>
                  <th>Fee Mandate</th>
                  <th>Bank/Investor Status</th>
                  <th>Owner</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${
                  list.length
                    ? list.map(renderMandateRow).join("")
                    : '<tr><td colspan="8" class="subtle">No signed mandates yet.</td></tr>'
                }
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;
  }

  function renderMandateRow(item) {
    const owner = state.users.find((u) => u.id === item.ownerId);
    return `
      <tr>
        <td>
          <strong>${escapeHtml(item.clientName)}</strong><br />
          <span class="subtle">${renderContactSummary(item.contacts)}</span>
        </td>
        <td>${escapeHtml(cap(item.mandateType))}</td>
        <td>${escapeHtml(formatMoney(item.fundraisingAmount))}</td>
        <td>${escapeHtml(String(item.feePercentage))}%</td>
        <td>${escapeHtml(formatMoney(item.feeMandateAmount))}</td>
        <td>${(item.tracks || [])
          .map(
            (track) => `
            <span class="badge-track">
              <strong>${escapeHtml(track.institution)}</strong><br />
              ${escapeHtml(track.currentStatus)} -> ${escapeHtml(track.nextStep)}
            </span>`
          )
          .join("")}</td>
        <td>${escapeHtml(owner ? owner.fullName : "-")}</td>
        <td>
          <button class="btn-secondary btn-inline" data-action="edit-mandate" data-id="${item.id}">Edit</button>
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
                  <th>Client</th>
                  <th>Type</th>
                  <th>Fundraise</th>
                  <th>Owner</th>
                  <th>Fee %</th>
                  <th>Fee Mandate</th>
                  <th>Live Status Rows</th>
                </tr>
              </thead>
              <tbody>
                ${
                  filteredMandates.length
                    ? filteredMandates
                        .map((item) => {
                          const owner = state.users.find((u) => u.id === item.ownerId);
                          return `
                            <tr>
                              <td>${escapeHtml(item.clientName)}</td>
                              <td>${escapeHtml(cap(item.mandateType))}</td>
                              <td>${escapeHtml(formatMoney(item.fundraisingAmount))}</td>
                              <td>${escapeHtml(owner ? owner.fullName : "-")}</td>
                              <td>${escapeHtml(String(item.feePercentage))}%</td>
                              <td>${escapeHtml(formatMoney(item.feeMandateAmount))}</td>
                              <td>${(item.tracks || [])
                                .map(
                                  (track) => `
                                    <span class="badge-track">
                                      <strong>${escapeHtml(track.institution)}</strong><br />
                                      ${escapeHtml(track.currentStatus)} -> ${escapeHtml(track.nextStep)}
                                    </span>
                                  `
                                )
                                .join("")}</td>
                            </tr>
                          `;
                        })
                        .join("")
                    : '<tr><td colspan="7" class="subtle">No mandates found for selected filters.</td></tr>'
                }
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
              <input name="password" type="password" minlength="6" required />
            </label>
            <label>Role
              <select name="role">
                <option value="employee">Employee</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <button class="btn-primary" type="submit" style="grid-column: 1 / -1;">Create User</button>
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
    return tracks
      .map(
        (track, index) => `
      <div class="track-row">
        <div class="row cols-3">
          <label>Bank / Investor
            <input data-model="${target}" data-kind="track" data-index="${index}" data-field="institution" value="${escapeAttr(track.institution)}" required />
          </label>
          <label>Current Status
            <input data-model="${target}" data-kind="track" data-index="${index}" data-field="currentStatus" value="${escapeAttr(track.currentStatus)}" required />
          </label>
          <label>Next Step
            <input data-model="${target}" data-kind="track" data-index="${index}" data-field="nextStep" value="${escapeAttr(track.nextStep)}" required />
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
      await submitConvert();
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
    state.mandateForm.fundraisingAmount = String(fd.get("fundraisingAmount") || "").trim();
    state.mandateForm.mandateType = String(fd.get("mandateType") || "debt");
    state.mandateForm.debtEquityAmount = String(fd.get("debtEquityAmount") || "").trim();
    state.mandateForm.feePercentage = String(fd.get("feePercentage") || "").trim();
    state.mandateForm.feeMandateAmount = String(fd.get("feeMandateAmount") || "").trim();
    state.mandateForm.ownerId = String(fd.get("ownerId") || "");

    const payload = {
      ...state.mandateForm,
      contacts: state.mandateForm.contacts,
      tracks: state.mandateForm.tracks
    };
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

  async function submitConvert() {
    resetFlash();
    if (!state.convertPipelineId) {
      return;
    }
    try {
      await api(`/api/pipeline/${state.convertPipelineId}/convert`, {
        method: "POST",
        body: {
          ...state.convertForm,
          contacts: state.convertForm.contacts,
          tracks: state.convertForm.tracks
        }
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
      const item = state.pipeline.find((p) => p.id === id);
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
      return;
    }

    if (action === "edit-mandate") {
      const id = Number(actionEl.getAttribute("data-id"));
      const item = state.mandates.find((m) => m.id === id);
      if (!item) {
        return;
      }
      state.mandateEditId = id;
      state.mandateForm = {
        clientName: item.clientName || "",
        fundraisingAmount: String(item.fundraisingAmount ?? ""),
        mandateType: item.mandateType || "debt",
        debtEquityAmount: String(item.debtEquityAmount ?? ""),
        feePercentage: String(item.feePercentage ?? ""),
        feeMandateAmount: String(item.feeMandateAmount ?? ""),
        ownerId: String(item.ownerId || ""),
        contacts: cloneArray(item.contacts, defaultContacts()),
        tracks: cloneArray(item.tracks, defaultTracks())
      };
      state.tab = "mandates";
      setFlashSuccess("Signed mandate loaded for edit.");
      render();
      return;
    }

    if (action === "open-convert") {
      const id = Number(actionEl.getAttribute("data-id"));
      const item = state.pipeline.find((p) => p.id === id);
      if (!item) {
        return;
      }
      state.convertPipelineId = id;
      state.convertForm = {
        clientName: item.companyName || "",
        fundraisingAmount: "",
        mandateType: item.requirementType || "debt",
        debtEquityAmount: "",
        feePercentage: "",
        feeMandateAmount: "",
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
      if (model.tracks.length <= 1) {
        setFlashError("At least 1 bank/investor status row is required.");
        render();
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
    if (target.matches("select[data-filter]")) {
      const key = target.getAttribute("data-filter");
      if (!key) {
        return;
      }
      state.adminFilters[key] = target.value;
      render();
    }
  }

  function onInput(event) {
    const input = event.target;
    if (!(input instanceof HTMLElement)) {
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

  function cloneArray(source, fallbackFactory) {
    if (!Array.isArray(source) || source.length === 0) {
      return fallbackFactory();
    }
    return source.map((item) => ({ ...item }));
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
