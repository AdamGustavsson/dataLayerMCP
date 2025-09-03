// schema.ts - Schema markup MCP tool
import { v4 as uuidv4 } from "uuid";
import WebSocket from "ws";
import { connectionState, wsSend } from "../connection/websocket.js";
import { logError } from "../utils/logging.js";
import { amIActiveInstance, getInstanceInfo } from "../utils/instance.js";
export function registerSchemaMarkupTool(mcpServer) {
    mcpServer.tool("getSchemaMarkup", "Extract and return all schema markup (JSON-LD and microdata) found on the current page, including structured data for SEO and rich snippets.", {}, async () => {
        if (!amIActiveInstance()) {
            const info = getInstanceInfo();
            throw new Error(`This server instance is not active (instanceId=${info.instanceId}). A newer instance likely took over. Please use the latest server instance.`);
        }
        const socket = connectionState.socket;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            throw new Error("Chrome extension is not connected. Please ensure the extension is installed and a tab is attached.");
        }
        const requestId = uuidv4();
        const payload = {
            type: "REQUEST_SCHEMA_MARKUP",
            requestId,
            timestamp: Date.now(),
        };
        if (!wsSend(socket, payload)) {
            throw new Error("Failed to send request to extension (inactive server or no connection).");
        }
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve({
                    content: [{
                            type: "text",
                            text: "Request timed out after 30 seconds"
                        }],
                    isError: true
                });
            }, 30000);
            const messageHandler = (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.type === "SCHEMA_MARKUP_RESPONSE" && msg.requestId === requestId) {
                        clearTimeout(timeout);
                        socket.off("message", messageHandler);
                        if (msg.payload?.error) {
                            resolve({
                                content: [{
                                        type: "text",
                                        text: String(msg.payload.error)
                                    }],
                                isError: true
                            });
                        }
                        else {
                            // Emit ALL schema as compact YAML (jsonLd + microdata)
                            try {
                                const payload = msg.payload || {};
                                const yaml = buildSchemaYaml(payload);
                                resolve({
                                    content: [
                                        { type: "text", text: yaml },
                                    ],
                                });
                            }
                            catch (e) {
                                // Safety fallback to JSON
                                resolve({
                                    content: [
                                        { type: "text", text: JSON.stringify(msg.payload, null, 2) },
                                    ],
                                });
                            }
                        }
                    }
                }
                catch (error) {
                    logError("Error parsing response:", error);
                }
            };
            socket.on("message", messageHandler);
        });
    });
}
// --- Helpers: Build compact YAML for full schema (JSON-LD + microdata) ---
function buildSchemaYaml(payload) {
    const jsonLdItems = [];
    const jsonLd = Array.isArray(payload?.jsonLd) ? payload.jsonLd : [];
    for (const entry of jsonLd) {
        const parsed = entry?.parsed;
        if (parsed == null)
            continue; // skip parse errors
        if (Array.isArray(parsed))
            jsonLdItems.push(...parsed);
        else
            jsonLdItems.push(parsed);
    }
    const microItemsRaw = Array.isArray(payload?.microdataStructured)
        ? payload.microdataStructured
        : [];
    const microItems = microItemsRaw.map((it) => normalizeMicrodataItem(it));
    const root = {};
    if (jsonLdItems.length)
        root.jsonLd = jsonLdItems;
    if (microItems.length)
        root.microdata = microItems;
    // If neither exists, return an empty doc to avoid confusion
    if (!jsonLdItems.length && !microItems.length)
        return "{}";
    return toYaml(root);
}
function asArray(v) {
    if (v == null)
        return [];
    return Array.isArray(v) ? v : [v];
}
function pick(obj, key) {
    return obj && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}
// Preserve data as-is; add '@id' if provided via microdata itemid meta
function normalizeMicrodataItem(item) {
    if (!item || typeof item !== "object")
        return item;
    const copy = {};
    for (const k of Object.keys(item)) {
        if (k === "_meta")
            continue; // drop extractor meta by default
        copy[k] = item[k];
    }
    const id = item?._meta?.itemid;
    if (id && !copy["@id"])
        copy["@id"] = id;
    return copy;
}
// Retained for potential future single-Product formatting
function buildProductYaml(product) {
    // Normalize images to array of strings
    const images = asArray(pick(product, "image")).filter(Boolean);
    // Flatten offers: take first offer object if present
    let offers = undefined;
    const offersArr = asArray(pick(product, "offers"));
    if (offersArr.length > 0)
        offers = offersArr[0];
    // Optional nested structures
    const priceSpecArr = offers ? asArray(pick(offers, "priceSpecification")) : [];
    const priceSpec = priceSpecArr.length > 0 ? priceSpecArr[0] : undefined;
    const shippingDetailsArr = offers ? asArray(pick(offers, "shippingDetails")) : [];
    const shippingDetails = shippingDetailsArr.length > 0 ? shippingDetailsArr[0] : undefined;
    const shippingRateArr = shippingDetails ? asArray(pick(shippingDetails, "shippingRate")) : [];
    const shippingRate = shippingRateArr.length > 0 ? shippingRateArr[0] : undefined;
    const deliveryTimeArr = shippingDetails ? asArray(pick(shippingDetails, "deliveryTime")) : [];
    const deliveryTime = deliveryTimeArr.length > 0 ? deliveryTimeArr[0] : undefined;
    const hasReturnPolicyArr = offers ? asArray(pick(offers, "hasMerchantReturnPolicy")) : [];
    const merchantReturn = hasReturnPolicyArr.length > 0 ? hasReturnPolicyArr[0] : undefined;
    // Build compact JS object in desired key order
    const productOut = {};
    productOut["@type"] = product?.["@type"] || "Product";
    if (pick(product, "name"))
        productOut.name = pick(product, "name");
    if (pick(product, "sku"))
        productOut.sku = pick(product, "sku");
    if (pick(product, "description"))
        productOut.description = pick(product, "description");
    if (images.length)
        productOut.image = images;
    if (offers && typeof offers === "object") {
        const offersOut = {};
        offersOut["@type"] = offers?.["@type"] || "Offer";
        if (pick(offers, "url"))
            offersOut.url = pick(offers, "url");
        if (pick(offers, "price"))
            offersOut.price = pick(offers, "price");
        if (pick(offers, "priceCurrency"))
            offersOut.priceCurrency = pick(offers, "priceCurrency");
        if (pick(offers, "availability"))
            offersOut.availability = pick(offers, "availability");
        if (priceSpec && typeof priceSpec === "object") {
            const ps = {};
            ps["@type"] = priceSpec?.["@type"] || "UnitPriceSpecification";
            if (pick(priceSpec, "priceType"))
                ps.priceType = pick(priceSpec, "priceType");
            if (pick(priceSpec, "price"))
                ps.price = pick(priceSpec, "price");
            if (pick(priceSpec, "priceCurrency"))
                ps.priceCurrency = pick(priceSpec, "priceCurrency");
            offersOut.priceSpecification = ps;
        }
        if (shippingDetails && typeof shippingDetails === "object") {
            const sd = {};
            sd["@type"] = shippingDetails?.["@type"] || "OfferShippingDetails";
            if (shippingRate && typeof shippingRate === "object") {
                const sr = {};
                sr["@type"] = shippingRate?.["@type"] || "MonetaryAmount";
                if (pick(shippingRate, "currency"))
                    sr.currency = pick(shippingRate, "currency");
                if (pick(shippingRate, "maxValue"))
                    sr.maxValue = pick(shippingRate, "maxValue");
                sd.shippingRate = sr;
            }
            if (deliveryTime && typeof deliveryTime === "object") {
                const dt = {};
                dt["@type"] = deliveryTime?.["@type"] || "ShippingDeliveryTime";
                const handling = pick(deliveryTime, "handlingTime");
                const transit = pick(deliveryTime, "transitTime");
                if (handling && typeof handling === "object") {
                    dt.handlingTime = {
                        "@type": handling?.["@type"] || "QuantitativeValue",
                        minValue: pick(handling, "minValue"),
                        maxValue: pick(handling, "maxValue"),
                        unitCode: pick(handling, "unitCode"),
                    };
                }
                if (transit && typeof transit === "object") {
                    dt.transitTime = {
                        "@type": transit?.["@type"] || "QuantitativeValue",
                        minValue: pick(transit, "minValue"),
                        maxValue: pick(transit, "maxValue"),
                        unitCode: pick(transit, "unitCode"),
                    };
                }
                sd.deliveryTime = dt;
            }
            offersOut.shippingDetails = sd;
        }
        if (merchantReturn && typeof merchantReturn === "object") {
            const mr = {};
            mr["@type"] = merchantReturn?.["@type"] || "MerchantReturnPolicy";
            if (pick(merchantReturn, "returnPolicyCategory"))
                mr.returnPolicyCategory = pick(merchantReturn, "returnPolicyCategory");
            if (pick(merchantReturn, "merchantReturnDays"))
                mr.merchantReturnDays = pick(merchantReturn, "merchantReturnDays");
            if (pick(merchantReturn, "returnMethod"))
                mr.returnMethod = pick(merchantReturn, "returnMethod");
            if (pick(merchantReturn, "returnFees"))
                mr.returnFees = pick(merchantReturn, "returnFees");
            const country = pick(merchantReturn, "applicableCountry");
            if (country && typeof country === "object") {
                mr.applicableCountry = {
                    "@type": country?.["@type"] || "Country",
                    name: pick(country, "name"),
                };
            }
            offersOut.hasMerchantReturnPolicy = mr;
        }
        productOut.offers = offersOut;
    }
    // Wrap into top-level key 'product'
    const root = { product: productOut };
    return toYaml(root);
}
function toYaml(obj) {
    function isPlainObject(v) {
        return v && typeof v === "object" && !Array.isArray(v);
    }
    function isScalar(v) {
        return (v == null ||
            typeof v === "string" ||
            typeof v === "number" ||
            typeof v === "boolean");
    }
    function canInlineObject(o) {
        if (!isPlainObject(o))
            return false;
        const keys = Object.keys(o);
        if (keys.length === 0)
            return true;
        if (keys.length > 6)
            return false; // keep small
        for (const k of keys) {
            const v = o[k];
            if (!isScalar(v))
                return false;
            if (typeof v === "string" && /\n/.test(v))
                return false;
        }
        return true;
    }
    function serialize(key, value, indent, forceBlockScalar = false) {
        const pad = "  ".repeat(indent);
        const keyPart = key ? `${key}:` : "";
        if (value == null) {
            return key ? `${pad}${keyPart} null\n` : `${pad}null\n`;
        }
        if (Array.isArray(value)) {
            let out = key ? `${pad}${keyPart}\n` : "";
            for (const item of value) {
                if (isPlainObject(item)) {
                    out += `${pad}-\n`;
                    for (const k of Object.keys(item)) {
                        out += serialize(k, item[k], indent + 1);
                    }
                }
                else {
                    out += `${pad}- ${formatScalar(item)}\n`;
                }
            }
            return out;
        }
        if (isPlainObject(value)) {
            // Inline small simple objects to save tokens
            if (key && canInlineObject(value) && !forceBlockScalar) {
                const parts = [];
                for (const k of Object.keys(value)) {
                    parts.push(`${k}: ${formatScalar(value[k])}`);
                }
                return `${pad}${keyPart} { ${parts.join(", ")} }\n`;
            }
            let out = key ? `${pad}${keyPart}\n` : "";
            // Keep insertion order
            for (const k of Object.keys(value)) {
                // Special-case: make description block scalar if long or contains newline
                const v = value[k];
                const useBlock = k === "description" && typeof v === "string" && v.length > 60;
                out += serialize(k, v, indent + 1, useBlock);
            }
            return out;
        }
        // Scalar
        if (forceBlockScalar && typeof value === "string") {
            const lines = value.replace(/\r\n/g, "\n");
            return `${pad}${keyPart} |\n${indentBlock(lines, indent + 1)}`;
        }
        return `${pad}${keyPart} ${formatScalar(value)}\n`;
    }
    function formatScalar(v) {
        if (typeof v === "number")
            return String(v);
        if (typeof v === "boolean")
            return v ? "true" : "false";
        if (typeof v === "string") {
            // Quote numeric-looking strings and reserved-like scalars to preserve exact form
            const looksNumeric = /^-?\d+(?:\.\d+)?$/.test(v);
            const needsQuote = looksNumeric || /[:#\-]|^\s|\s$|^(?:true|false|null|~)$/i.test(v);
            const hasNewline = /\n/.test(v);
            if (hasNewline)
                return `|\n${indentBlock(v, 1)}`; // caller usually handles block
            return needsQuote ? JSON.stringify(v) : v;
        }
        return JSON.stringify(v);
    }
    function indentBlock(text, indent) {
        const pad = "  ".repeat(indent);
        return text
            .split("\n")
            .map((l) => `${pad}${l}`)
            .join("\n") + "\n";
    }
    let out = "";
    for (const k of Object.keys(obj)) {
        out += serialize(k, obj[k], 0);
    }
    return out.trimEnd();
}
