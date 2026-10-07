import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./catalog.js", import.meta.url), "utf8");
const initialProduct = {
    id: 1, title: "Тестовый товар", description: "Описание", category: "beauty",
    brand: "NOVA", price: 10, stock: 5, rating: 4.5, thumbnail: "",
};
const apiUrl = "https://dummyjson.com/products";

function setup(options = {}) {
    const requests = [];
    const context = vm.createContext({
        URL, AbortSignal,
        localStorage: new Proxy({}, { get() { throw new Error("Каталог не должен обращаться к localStorage"); } }),
        fetch: async (url, init) => {
            const request = { url, ...init, data: init.body ? JSON.parse(init.body) : undefined };
            requests.push(request);
            if (options.offline) throw new Error("offline");
            if (options.respond) return options.respond(request);
            if (options.status) return { ok: false, status: options.status };
            let data;
            if (init.method === "GET") data = { products: [initialProduct] };
            if (init.method === "POST") data = { ...request.data, id: 195 };
            if (init.method === "PUT") data = { ...initialProduct, ...request.data };
            if (init.method === "DELETE") data = { ...initialProduct, isDeleted: true };
            return { ok: true, json: async () => data };
        },
    });
    vm.runInContext(source + "\nglobalThis.store = productStore;", context);
    return { store: context.store, requests };
}

test("CRUD отправляет GET, POST, PUT и DELETE в DummyJSON", async () => {
    const { store, requests } = setup();
    await store.load();
    const created = await store.create({ ...initialProduct, title: "Новый товар" });
    assert.equal(created.apiId, 195);
    assert.equal(created.rating, 0);
    await store.update(1, { title: "Новое название", price: 12.5, stock: 0 });
    assert.equal(store.read().find((item) => item.id === 1).price, 12.5);
    await store.remove(1);
    assert.equal(store.read().some((item) => item.id === 1), false);
    assert.deepEqual(requests.map(({ url, method }) => ({ url, method })), [
        { url: apiUrl + "?limit=0", method: "GET" },
        { url: apiUrl + "/add", method: "POST" },
        { url: apiUrl + "/1", method: "PUT" },
        { url: apiUrl + "/1", method: "DELETE" },
    ]);
    assert.equal(requests[1].headers["Content-Type"], "application/json");
    assert.equal(requests[2].headers["Content-Type"], "application/json");
    assert.equal(requests[1].data.title, "Новый товар");
    assert.equal(requests[2].data.price, 12.5);
    for (const request of requests.filter((item) => item.data)) {
        assert.equal("id" in request.data, false);
        assert.equal("apiId" in request.data, false);
        assert.equal("createdInSession" in request.data, false);
    }
    // Повторная загрузка читает исходные данные с API, без локального сохранения.
    await store.load();
    assert.equal(requests.at(-1).method, "GET");
    assert.equal(store.read().length, 1);
    assert.equal(store.read()[0].title, initialProduct.title);
});

test("до ответа API карточки не меняются; используются данные ответа", async () => {
    const options = {};
    const { store } = setup(options);
    await store.load();
    let respond;
    options.respond = () => new Promise((resolve) => { respond = resolve; });
    const creating = store.create({ ...initialProduct, title: "Отправленное название" });
    assert.equal(store.read().length, 1);
    respond({ ok: true, json: async () => ({ ...initialProduct, id: 195, title: "Название из ответа" }) });
    await creating;
    assert.equal(store.read()[0].title, "Название из ответа");

    const updating = store.update(1, { price: 20 });
    assert.equal(store.read().find((item) => item.id === 1).price, 10);
    respond({ ok: true, json: async () => ({ ...initialProduct, price: 21 }) });
    await updating;
    assert.equal(store.read().find((item) => item.id === 1).price, 21);

    const deleting = store.remove(1);
    assert.equal(store.read().some((item) => item.id === 1), true);
    respond({ ok: true, json: async () => ({ id: 1, isDeleted: true }) });
    await deleting;
    assert.equal(store.read().some((item) => item.id === 1), false);
});

test("HTTP и сетевые ошибки не создают ложных изменений", async () => {
    const options = {};
    const { store } = setup(options);
    await store.load();
    const before = JSON.stringify(store.read());
    for (const failure of [{ status: 500 }, { status: undefined, offline: true }]) {
        Object.assign(options, failure);
        await assert.rejects(store.create(initialProduct), /DummyJSON/);
        await assert.rejects(store.update(1, { price: 99 }), /DummyJSON/);
        await assert.rejects(store.remove(1), /DummyJSON/);
        assert.equal(JSON.stringify(store.read()), before);
    }
});

test("ошибки в полях не отправляют запросы на сервер", async () => {
    const { store, requests } = setup();
    await store.load();
    for (const values of [
        { title: "   " }, { description: "" }, { category: "" },
        { price: -1 }, { price: NaN }, { stock: 1.5 }, { stock: -1 },
        { thumbnail: "javascript:alert(1)" }, { thumbnail: "http://example.com/photo.jpg" },
    ]) {
        await assert.rejects(store.create({ ...initialProduct, ...values }));
        await assert.rejects(store.update(1, values));
    }
    assert.equal(requests.length, 1);
    assert.equal(store.read().length, 1);
});

test("повторный POST с одинаковым серверным id не смешивает карточки", async () => {
    const options = {};
    const { store, requests } = setup(options);
    await store.load();
    const first = await store.create({ ...initialProduct, title: "Первый" });
    const second = await store.create({ ...initialProduct, title: "Второй" });
    assert.notEqual(first.id, second.id);
    assert.equal(first.apiId, 195);
    assert.equal(second.apiId, 195);
    assert.equal(store.read().length, 3);

    options.status = 404;
    await assert.rejects(store.update(second.id, { price: 99 }), /не сохраняет добавленные товары/);
    assert.equal(requests.at(-1).url, apiUrl + "/195");
    await assert.rejects(store.remove(second.id), /HTTP 404/);
    assert.equal(requests.at(-1).url, apiUrl + "/195");
    assert.equal(store.read().length, 3);
    assert.equal(store.read().find((item) => item.id === second.id).price, 10);
});

test("ошибочный ответ API не применяется", async () => {
    const options = {};
    const { store } = setup(options);
    await store.load();
    const before = JSON.stringify(store.read());
    options.respond = async () => ({ ok: true, json: async () => ({ id: 999, isDeleted: true }) });
    await assert.rejects(store.create(initialProduct));
    await assert.rejects(store.update(1, { price: 20 }), /идентификатор/);
    await assert.rejects(store.remove(1), /не подтвердил/);
    options.respond = async () => ({ ok: true, json: async () => { throw new Error("bad json"); } });
    await assert.rejects(store.create(initialProduct), /некорректный ответ/);
    assert.equal(JSON.stringify(store.read()), before);
});

test("до загрузки CRUD недоступен, ошибка загрузки допускает повтор", async () => {
    const options = { offline: true };
    const { store, requests } = setup(options);
    await assert.rejects(store.create(initialProduct), /дождитесь загрузки/);
    assert.equal(requests.length, 0);
    await assert.rejects(store.load(), /Нет ответа/);
    assert.equal(store.read().length, 0);
    options.offline = false;
    await store.load();
    store.read()[0].price = 999;
    assert.equal(store.read()[0].price, 10);
});

