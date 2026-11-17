const base = process.env.API_URL ?? "http://127.0.0.1:8080";

async function request(path, options = {}, token = "") {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${path}: ${response.status} ${JSON.stringify(json)}`);
  return json.data ?? json;
}

const session = await request("/auth/login", {
  method: "POST", body: JSON.stringify({ username: "MENG_YING", password: "my" }),
});
const token = session.token;

const requiredCustomers = [
  { code: "NETBIT", nameZh: "NetBit", nameEn: "NetBit" },
  { code: "ANKER", nameZh: "Anker", nameEn: "Anker" },
];
const requiredProducts = ["EPS48R1-36", "EPS18R1G-36", "EPS36R0-36", "B2672111", "B2672121"];

let customers = (await request("/erp/customers", {}, token)).items;
for (const item of requiredCustomers) {
  let customer = customers.find((candidate) => candidate.code === item.code);
  if (!customer) {
    customer = await request("/erp/customers", {
      method: "POST",
      body: JSON.stringify({ payload: { ...item, paymentTermsDays: 30, riskLevel: "LOW" } }),
    }, token);
    await request(`/erp/customers/${customer.item.id}/transition`, {
      method: "POST", body: JSON.stringify({ payload: { action: "submit", reason: "Initial approved customer master seed" } }),
    }, token);
    await request(`/erp/customers/${customer.item.id}/transition`, {
      method: "POST", body: JSON.stringify({ payload: { action: "approve", reason: "Factory manager approved initial customer master" } }),
    }, token);
  } else if (customer.lifecycleStatus !== "ACTIVE") {
    if (["DRAFT", "REJECTED"].includes(customer.lifecycleStatus)) {
      await request(`/erp/customers/${customer.id}/transition`, {
        method: "POST", body: JSON.stringify({ payload: { action: "submit", reason: "Approve required customer master" } }),
      }, token);
      customer.lifecycleStatus = "PENDING_APPROVAL";
    }
    if (customer.lifecycleStatus === "PENDING_APPROVAL") {
      await request(`/erp/customers/${customer.id}/transition`, {
        method: "POST", body: JSON.stringify({ payload: { action: "approve", reason: "Factory manager approved required customer master" } }),
      }, token);
    } else if (customer.lifecycleStatus === "ON_HOLD") {
      await request(`/erp/customers/${customer.id}/transition`, {
        method: "POST", body: JSON.stringify({ payload: { action: "reactivate", reason: "Factory manager reactivated required customer master" } }),
      }, token);
    }
  }
  customers = (await request("/erp/customers", {}, token)).items;
}

let products = (await request("/erp/products", {}, token)).items;
for (const code of requiredProducts) {
  if (!products.some((item) => item.code === code)) {
    await request("/erp/products", {
      method: "POST",
      body: JSON.stringify({ payload: { code, nameZh: code, nameEn: code, revision: "V1.0" } }),
    }, token);
  }
  products = (await request("/erp/products", {}, token)).items;
}

console.log(JSON.stringify({
  customers: customers.filter((item) => requiredCustomers.some((required) => required.code === item.code))
    .map(({ code, name, lifecycleStatus }) => ({ code, name, lifecycleStatus })),
  products: products.filter((item) => requiredProducts.includes(item.code))
    .map(({ code, status }) => ({ code, status })),
}, null, 2));
