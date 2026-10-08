// src/pages/master/AdminMasterUserForm.jsx
//
// Admin Master — Add New / Edit account form. Same component handles
// both: create mode (/master/admin-master/users/add) and edit mode
// (/master/admin-master/users/:id/edit).
//
// Now includes: State -> District cascading dropdowns (real data from
// src/data/indiaStatesDistricts.js) and a "Customer" option in the User Role Type dropdown.
import { useTheme } from "../../ThemeContext";
import { useState, useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Layout from "../../components/Layout";
import { getG } from "../../theme";
import API from "../../services/api";
import { INDIA_STATES, districtsOfState, stateOfDistrict, sameName } from "../../data/indiaStatesDistricts";

const FONT = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const ROLE_OPTIONS = [
  { value: "end_user", label: "End User" },
  { value: "customer", label: "Customer" },
  { value: "admin", label: "Admin" },
  { value: "system_admin", label: "System Admin" },
];

const DESIGNATION_OPTIONS = [
  "Manager", "Assistant Manager", "Supervisor", "Team Lead",
  "Executive", "Coordinator", "Officer", "Analyst", "Staff", "Other",
];

const emptyForm = {
  role: "end_user",
  name: "",
  designation: "",
  designationOther: "",
  state: "",
  district: "",
  userId: "",
  password: "",
  confirmPassword: "",
  active: "yes",
  oracleId: "",
};

const Field = ({ label, required, children }) => {
  const { isDark } = useTheme();
  const themeG = getG(isDark);
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: themeG.textLabel, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, fontFamily: FONT }}>
        {label}{required && <span style={{ color: "#B23A3A" }}> *</span>}
      </label>
      {children}
    </div>
  );
};

const Input = (props) => (
  <input {...props} style={{ width: "100%", padding: "9px 13px", borderRadius: 9, border: "1px solid rgba(15,33,56,0.18)", fontSize: 14, fontFamily: FONT, color: "#0F2138", background: "#ffffff", outline: "none", boxSizing: "border-box", ...props.style }} />
);

const Select = ({ children, ...props }) => (
  <select {...props} style={{ width: "100%", padding: "9px 13px", borderRadius: 9, border: "1px solid rgba(15,33,56,0.18)", fontSize: 14, fontFamily: FONT, color: "#0F2138", background: "#ffffff", outline: "none", boxSizing: "border-box" }}>
    {children}
  </select>
);

export default function AdminMasterUserForm() {
  const { isDark } = useTheme();
  const themeG = getG(isDark);
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);

  const card = { background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, padding: 24, boxShadow: "0 4px 16px rgba(46,122,114,0.05)" };
  const cardTitle = { fontFamily: FONT, fontSize: 16, fontWeight: 600, margin: "0 0 20px", color: themeG.textMain };

  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // State change resets district.
  const handleStateChange = (state) =>
    setForm((f) => ({ ...f, state, district: "" }));

  const handleDistrictChange = (district) =>
    setForm((f) => ({ ...f, district }));

  const districtOptions = useMemo(() => districtsOfState(form.state), [form.state]);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await API.get(`/accounts/${id}`);
        const a = res.data;
        const knownDesignation = DESIGNATION_OPTIONS.includes(a.Designation) ? a.Designation : "Other";
        setForm({
          role: a.role || "end_user",
          name: a.name || "",
          designation: knownDesignation,
          designationOther: knownDesignation === "Other" ? (a.Designation || "") : "",
          state: a.State || stateOfDistrict(a.District) || "",
          district: a.District || "",
          userId: a.email || "",
          password: "",
          confirmPassword: "",
          active: (a.Status || "active").toLowerCase() === "active" ? "yes" : "no",
        });
      } catch (err) {
        setError(err.response?.data?.message || "Failed to load account.");
      } finally {
        setLoading(false);
      }
    })();
    /* eslint-disable-next-line */
  }, [id]);

  const handleClear = () => setForm(emptyForm);

  const handleSubmit = async () => {
    setError("");

    const designationValue = form.designation === "Other" ? form.designationOther.trim() : form.designation;

    if (!form.name.trim() || !form.userId.trim() || !designationValue) {
      setError("Please fill in username, user ID and designation.");
      return;
    }
    if (!isEdit && !form.password) {
      setError("Please set a password for the new account.");
      return;
    }
    if (form.password && form.password !== form.confirmPassword) {
      setError("Password and Confirm Password do not match.");
      return;
    }

    const payload = {
      name: form.name.trim(),
      userId: form.userId.trim(),
      designation: designationValue,
      state: form.state || null,
      district: form.district || null,
      role: form.role,
      active: form.active === "yes",
    };
    if (form.password) {
      payload.password = form.password;
      payload.password_confirmation = form.confirmPassword;
    }
    if (form.role === "customer" && form.oracleId.trim()) {
      payload.oracleId = form.oracleId.trim();
    }

    setSaving(true);
    try {
      if (isEdit) {
        await API.put(`/accounts/${id}`, payload);
      } else {
        await API.post("/accounts", payload);
      }
      navigate("/master/admin-master/users");
    } catch (err) {
      setError(err.response?.data?.message || `Failed to ${isEdit ? "update" : "save"} account.`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Layout pageTitle={isEdit ? "Edit User" : "Add New User"}>
        <p style={{ color: themeG.textSub }}>Loading…</p>
      </Layout>
    );
  }

  return (
    <Layout pageTitle={isEdit ? "Edit User" : "Add New User"} pageSubtitle="Admin Master — account details">
      {error && (
        <div style={{ marginBottom: 16, background: "rgba(178,58,58,0.08)", border: "1px solid rgba(178,58,58,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#B23A3A", fontFamily: FONT }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* ── Left card: Identity ── */}
        <div style={card}>
          <h3 style={cardTitle}>Account Details</h3>

          <Field label="User Role Type" required>
            <Select value={form.role} onChange={(e) => set("role", e.target.value)}>
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </Select>
          </Field>

          <Field label="User Name" required>
            <Input placeholder="e.g. Ramesh Kumar" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>

          <Field label="State">
            <Select value={form.state} onChange={(e) => handleStateChange(e.target.value)}>
              <option value="">Select state…</option>
              {INDIA_STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </Field>

          <Field label="District">
            <Select value={form.district} onChange={(e) => handleDistrictChange(e.target.value)}>
              <option value="">{form.state ? "Select district…" : "Select district (all states)…"}</option>
              {districtOptions.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
              {/* keep a saved value visible even if it's not in the list */}
              {form.district && !districtOptions.some((d) => sameName(d, form.district)) && (
                <option value={form.district}>{form.district}</option>
              )}
            </Select>
          </Field>

          <Field label="Designation" required>
            <Select value={form.designation} onChange={(e) => set("designation", e.target.value)}>
              <option value="">Select designation…</option>
              {DESIGNATION_OPTIONS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </Select>
          </Field>

          {form.designation === "Other" && (
            <Field label="Specify Designation" required>
              <Input placeholder="Enter designation" value={form.designationOther} onChange={(e) => set("designationOther", e.target.value)} />
            </Field>
          )}

          <Field label="User ID" required>

            <Input placeholder="Login ID used to sign in" value={form.userId} onChange={(e) => set("userId", e.target.value)} />
          </Field>
          {form.role === "customer" && (
            <Field label="Oracle Partner No (optional)">
              <Input
                placeholder="ERP partner number, leave blank to auto-detect"
                value={form.oracleId}
                onChange={(e) => set("oracleId", e.target.value)}
              />
            </Field>
          )}

        </div>

        {/* ── Right card: Credentials + Status ── */}
        <div style={card}>
          <h3 style={cardTitle}>Login & Status</h3>

          <Field label={isEdit ? "New Password (leave blank to keep current)" : "Password"} required={!isEdit}>
            <Input type="password" placeholder={isEdit ? "••••••••" : "Set a password"} value={form.password} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" />
          </Field>

          <Field label="Confirm Password" required={!isEdit || Boolean(form.password)}>
            <Input type="password" placeholder="Re-enter password" value={form.confirmPassword} onChange={(e) => set("confirmPassword", e.target.value)} autoComplete="new-password" />
          </Field>

          <Field label="Active Status" required>
            <div style={{ display: "flex", gap: 20, paddingTop: 4 }}>
              {[["yes", "Yes"], ["no", "No"]].map(([val, label]) => (
                <label key={val} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 14, color: themeG.textMain, fontFamily: FONT, cursor: "pointer" }}>
                  <input type="radio" name="active" value={val} checked={form.active === val} onChange={(e) => set("active", e.target.value)} />
                  {label}
                </label>
              ))}
            </div>
          </Field>

          {/* Live preview strip */}
          <div style={{ marginTop: 8, padding: "12px 16px", borderRadius: 10, border: `1.5px solid ${themeG.border}`, background: themeG.bg }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: themeG.textMain, fontFamily: FONT }}>{form.name || "Username preview"}</p>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: themeG.textSub, fontFamily: FONT }}>
              {ROLE_OPTIONS.find((r) => r.value === form.role)?.label} · {form.designation === "Other" ? (form.designationOther || "Designation") : (form.designation || "Designation")} · {form.active === "yes" ? "Active" : "Inactive"}
            </p>
            {(form.state || form.district) && (
              <p style={{ margin: "2px 0 0", fontSize: 12, color: themeG.textSub, fontFamily: FONT }}>
                {[form.district, form.state].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 28, justifyContent: "flex-end" }}>
        {isEdit ? (
          <>
            <button onClick={() => navigate("/master/admin-master/users")}
              style={{ padding: "10px 24px", borderRadius: 9, border: `1px solid ${themeG.border}`, background: themeG.card, color: themeG.textSub, cursor: "pointer", fontFamily: FONT, fontSize: 14, fontWeight: 500 }}>
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={saving}
              style={{ padding: "10px 28px", borderRadius: 9, border: "none", background: "#16A34A", color: "#fff", cursor: saving ? "not-allowed" : "pointer", fontFamily: FONT, fontSize: 14, fontWeight: 700, boxShadow: "0 2px 10px rgba(22,163,74,0.32)", opacity: saving ? 0.6 : 1 }}>
              {saving ? "Updating…" : "Update"}
            </button>
          </>
        ) : (
          <>
            <button onClick={handleClear}
              style={{ padding: "10px 24px", borderRadius: 9, border: `1px solid ${themeG.border}`, background: themeG.card, color: themeG.textSub, cursor: "pointer", fontFamily: FONT, fontSize: 14, fontWeight: 500 }}>
              Clear
            </button>
            <button onClick={handleSubmit} disabled={saving}
              style={{ padding: "10px 28px", borderRadius: 9, border: "none", background: "#16A34A", color: "#fff", cursor: saving ? "not-allowed" : "pointer", fontFamily: FONT, fontSize: 14, fontWeight: 700, boxShadow: "0 2px 10px rgba(22,163,74,0.32)", opacity: saving ? 0.6 : 1 }}>
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        )}
      </div>
    </Layout>
  );
}