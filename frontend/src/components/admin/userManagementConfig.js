export const DEFAULT_GROUP_ENTITLEMENTS = {
  maxUsers: "",
  maxReportSources: "",
  maxAiQueriesPerMonth: "",
  aiMonthlyBudgetUsd: "",
  maxImportParseMemoryMb: "",
  features: {
    manageUsers: true,
    managePermissions: true,
    manageGroupAdmins: false,
    ai: true,
    exports: true,
    imports: true,
    approvalFlow: false,
    auditLogs: false,
    sso: true,
    googleDrive: true,
    dropbox: true,
    oneDrive: true,
    quickbooks: true,
    dlp: true,
  },
};

const RESET_PASSWORD_LENGTH = 16;
const RESET_PASSWORD_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{};:,.?";
const RESET_PASSWORD_REQUIRED_SETS = [
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "abcdefghijklmnopqrstuvwxyz",
  "0123456789",
  "!@#$%^&*()-_=+[]{};:,.?",
];

export const QUICKBOOKS_DATA_TYPE_OPTIONS = [
  "Accounts",
  "Bills",
  "Customers",
  "Invoices",
  "Items",
  "JournalEntries",
  "Payments",
  "Vendors",
];

export const INTEGRATION_LOGOS = {
  google: "https://www.google.com/s2/favicons?domain=google.com&sz=64",
  dropbox: "https://www.google.com/s2/favicons?domain=dropbox.com&sz=64",
  onedrive: "https://www.google.com/s2/favicons?domain=onedrive.live.com&sz=64",
  quickbooks: "https://www.google.com/s2/favicons?domain=quickbooks.intuit.com&sz=64",
  saml: "https://api.iconify.design/mdi:shield-key-outline.svg?color=%230ea5e9",
  sftp: "https://api.iconify.design/solar:folder-with-files-bold.svg?color=%230ea5e9",
  gcs: "https://www.google.com/s2/favicons?domain=cloud.google.com&sz=64",
  s3: "https://www.google.com/s2/favicons?domain=s3.amazonaws.com&sz=64",
  azure: "https://www.google.com/s2/favicons?domain=azure.microsoft.com&sz=64",
  email: "https://api.iconify.design/solar:letter-bold.svg?color=%230ea5e9",
};

export const STORAGE_PROVIDER_DEFS = [
  {
    key: "sftp",
    title: "SCP / SFTP",
    logoUrl: INTEGRATION_LOGOS.sftp,
    apiBase: "sftp-storage",
    summary: () => "",
    helpLinks: [
      { href: "https://www.openssh.com/manual.html", label: "OpenSSH / SFTP usage guide" },
    ],
    fields: [
      { name: "enabled", type: "checkbox", label: "Enable SFTP / SCP storage" },
      { name: "host", label: "Host", placeholder: "sftp.example.com" },
      { name: "port", label: "Port", type: "number", defaultValue: 22, placeholder: "22" },
      { name: "username", label: "Username", placeholder: "sftp-user" },
      {
        name: "authMode",
        label: "Authentication mode",
        type: "select",
        defaultValue: "password",
        options: [
          { value: "password", label: "Password" },
          { value: "ssh_key", label: "SSH key" },
        ],
      },
      {
        name: "password",
        label: "Password",
        type: "password",
        secret: true,
        metaKey: "hasPassword",
        placeholder: "SFTP password",
        showWhen: (form) => String(form.authMode || "password") === "password",
      },
      {
        name: "privateKey",
        label: "Private key",
        type: "textarea",
        rows: 6,
        secret: true,
        metaKey: "hasPrivateKey",
        placeholder: "-----BEGIN OPENSSH PRIVATE KEY-----",
        showWhen: (form) => String(form.authMode || "password") === "ssh_key",
      },
      {
        name: "passphrase",
        label: "Key passphrase",
        type: "password",
        secret: true,
        metaKey: "hasPassphrase",
        placeholder: "Optional passphrase",
        showWhen: (form) => String(form.authMode || "password") === "ssh_key",
      },
      { name: "remotePath", label: "Remote path", placeholder: "/incoming" },
    ],
  },
  {
    key: "gcs",
    title: "Google Cloud Storage",
    logoUrl: INTEGRATION_LOGOS.gcs,
    apiBase: "gcs-storage",
    summary: (state) => (
      state.form.enabled
        ? `${state.form.bucket || "No bucket"}${state.form.projectId ? ` • ${state.form.projectId}` : ""}`
        : ""
    ),
    helpLinks: [
      { href: "https://cloud.google.com/storage/docs/authentication", label: "Google Cloud Storage authentication" },
      { href: "https://cloud.google.com/iam/docs/service-accounts", label: "Create and manage service accounts" },
    ],
    fields: [
      { name: "enabled", type: "checkbox", label: "Enable Google Cloud Storage" },
      { name: "projectId", label: "Project ID", placeholder: "my-gcp-project" },
      { name: "bucket", label: "Bucket", placeholder: "customer-reports" },
      { name: "clientEmail", label: "Service account email", placeholder: "storage-import@project.iam.gserviceaccount.com" },
      {
        name: "privateKey",
        label: "Private key",
        type: "textarea",
        rows: 6,
        secret: true,
        metaKey: "hasPrivateKey",
        placeholder: "-----BEGIN PRIVATE KEY-----",
      },
      { name: "tokenUri", label: "Token URI", defaultValue: "https://oauth2.googleapis.com/token", placeholder: "https://oauth2.googleapis.com/token" },
      { name: "prefix", label: "Object prefix", placeholder: "reports/" },
    ],
  },
  {
    key: "s3",
    title: "Amazon S3",
    logoUrl: INTEGRATION_LOGOS.s3,
    apiBase: "s3-storage",
    summary: (state) => (
      state.form.enabled
        ? `${state.form.bucket || "No bucket"}${state.form.region ? ` • ${state.form.region}` : ""}`
        : ""
    ),
    helpLinks: [
      { href: "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html", label: "AWS access key guidance" },
      { href: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html", label: "Amazon S3 user guide" },
    ],
    fields: [
      { name: "enabled", type: "checkbox", label: "Enable Amazon S3" },
      { name: "bucket", label: "Bucket", placeholder: "customer-reports" },
      { name: "region", label: "Region", placeholder: "us-east-1" },
      { name: "accessKeyId", label: "Access key ID", placeholder: "AKIA..." },
      {
        name: "secretAccessKey",
        label: "Secret access key",
        type: "password",
        secret: true,
        metaKey: "hasSecretAccessKey",
        placeholder: "S3 secret access key",
      },
      { name: "endpointUrl", label: "Custom endpoint URL", defaultValue: "", placeholder: "https://s3.us-east-1.amazonaws.com" },
      { name: "pathStyleAccess", type: "checkbox", label: "Use path-style access" },
      { name: "prefix", label: "Object prefix", placeholder: "reports/" },
    ],
  },
  {
    key: "azure",
    title: "Azure Blob Storage",
    logoUrl: INTEGRATION_LOGOS.azure,
    apiBase: "azure-blob-storage",
    summary: (state) => (
      state.form.enabled
        ? `${state.form.accountName || "No account"}${state.form.container ? ` • ${state.form.container}` : ""}`
        : ""
    ),
    helpLinks: [
      { href: "https://learn.microsoft.com/en-us/azure/storage/blobs/storage-quickstart-blobs-portal", label: "Azure Blob Storage quickstart" },
      { href: "https://learn.microsoft.com/en-us/azure/storage/common/storage-account-keys-manage", label: "Manage storage account keys" },
    ],
    fields: [
      { name: "enabled", type: "checkbox", label: "Enable Azure Blob Storage" },
      { name: "accountName", label: "Account name", placeholder: "mystorageaccount" },
      {
        name: "accountKey",
        label: "Account key",
        type: "password",
        secret: true,
        metaKey: "hasAccountKey",
        placeholder: "Azure storage account key",
      },
      { name: "container", label: "Container", placeholder: "customer-reports" },
      { name: "endpointSuffix", label: "Endpoint suffix", defaultValue: "blob.core.windows.net", placeholder: "blob.core.windows.net" },
      { name: "prefix", label: "Blob prefix", placeholder: "reports/" },
    ],
  },
];

export function createStorageProviderState(def) {
  const form = {};
  const meta = {};
  for (const field of def.fields) {
    if (field.secret) {
      meta[field.metaKey] = false;
      form[field.name] = "";
      continue;
    }
    if (field.type === "checkbox") {
      form[field.name] = false;
      continue;
    }
    if (field.type === "number") {
      form[field.name] = field.defaultValue ?? "";
      continue;
    }
    form[field.name] = field.defaultValue ?? "";
  }
  return { form, meta, open: false, saving: false, testing: false, testStatus: null };
}

export function createInitialStorageState() {
  return Object.fromEntries(STORAGE_PROVIDER_DEFS.map((def) => [def.key, createStorageProviderState(def)]));
}

function secureRandomInt(max) {
  if (window.crypto?.getRandomValues) {
    const value = new Uint32Array(1);
    window.crypto.getRandomValues(value);
    return value[0] % max;
  }
  return Math.floor(Math.random() * max);
}

export function generateAdminPassword(length = RESET_PASSWORD_LENGTH) {
  const chars = RESET_PASSWORD_REQUIRED_SETS.map((set) => set[secureRandomInt(set.length)]);
  while (chars.length < length) {
    chars.push(RESET_PASSWORD_ALPHABET[secureRandomInt(RESET_PASSWORD_ALPHABET.length)]);
  }
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = secureRandomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export function normalizeGroupEntitlements(value) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    ...DEFAULT_GROUP_ENTITLEMENTS,
    ...raw,
    maxUsers: raw.maxUsers ?? "",
    maxReportSources: raw.maxReportSources ?? "",
    maxAiQueriesPerMonth: raw.maxAiQueriesPerMonth ?? "",
    aiMonthlyBudgetUsd: raw.aiMonthlyBudgetUsd ?? "",
    maxImportParseMemoryMb: raw.maxImportParseMemoryMb ?? "",
    features: {
      ...DEFAULT_GROUP_ENTITLEMENTS.features,
      ...(raw.features || {}),
    },
  };
}
