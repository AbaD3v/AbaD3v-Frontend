"use strict";

// Все операции CRUD отправляются в DummyJSON. В памяти остаются только
// ответы API для текущего отображения; каталог не записывается в localStorage.
const productStore = (() => {
    const apiUrl = "https://dummyjson.com/products";
    let items = [];
    let ready = false;

    function validate(product) {
        if (!product || typeof product.title !== "string" || !product.title.trim() || product.title.length > 160) {
            throw new Error("Укажите название товара (до 160 символов).");
        }
        if (typeof product.description !== "string" || !product.description.trim() || product.description.length > 2000) {
            throw new Error("Укажите описание товара (до 2000 символов).");
        }
        if (typeof product.category !== "string" || !product.category.trim()) {
            throw new Error("Выберите категорию.");
        }
        if (!Number.isFinite(product.price) || product.price < 0 || product.price > 999999999) {
            throw new Error("Укажите корректную цену от 0 до 999999999 USD.");
        }
        if (!Number.isInteger(product.stock) || product.stock < 0 || product.stock > 999999999) {
            throw new Error("Остаток должен быть целым числом от 0 до 999999999.");
        }
        if (!Number.isFinite(product.rating) || product.rating < 0 || product.rating > 5) {
            throw new Error("Рейтинг должен быть от 0 до 5.");
        }
        if (typeof product.brand !== "string" || product.brand.length > 100) {
            throw new Error("Название бренда должно быть не длиннее 100 символов.");
        }
        if (typeof product.thumbnail !== "string" || product.thumbnail.length > 2048) {
            throw new Error("Укажите корректную ссылку на фото.");
        }
        if (product.thumbnail) {
            try {
                if (new URL(product.thumbnail).protocol !== "https:") throw new Error();
            } catch {
                throw new Error("Ссылка на фото должна начинаться с https://.");
            }
        }
    }

    function assertReady() {
        if (!ready) throw new Error("Сначала дождитесь загрузки каталога.");
    }

    async function request(path, method = "GET", body) {
        let response;
        try {
            response = await fetch(`${apiUrl}${path}`, {
                method,
                ...(body ? {
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                } : {}),
                signal: AbortSignal.timeout(15000),
            });
        } catch {
            throw new Error("Нет ответа от DummyJSON. Проверьте интернет и попробуйте ещё раз.");
        }
        if (!response.ok) {
            const error = new Error(`DummyJSON отклонил запрос (HTTP ${response.status}). Попробуйте ещё раз.`);
            error.status = response.status;
            throw error;
        }
        try {
            return await response.json();
        } catch {
            throw new Error("DummyJSON вернул некорректный ответ. Изменения не применены.");
        }
    }

    function normalize(product) {
        if (!product || !Number.isSafeInteger(product.id) || product.id < 1) {
            throw new Error("DummyJSON вернул неверный идентификатор товара.");
        }
        const normalized = {
            id: product.id,
            apiId: product.id,
            title: product.title,
            description: product.description,
            category: product.category,
            brand: product.brand || "",
            price: product.price,
            stock: product.stock,
            rating: product.rating ?? 0,
            thumbnail: product.thumbnail || "",
        };
        validate(normalized);
        return normalized;
    }

    function payload(product) {
        // В API отправляются только поля товара, без идентификаторов интерфейса.
        return Object.fromEntries(["title", "description", "category", "brand", "price", "stock", "rating", "thumbnail"]
            .map((field) => [field, product[field]]));
    }

    async function mutate(product, method, body) {
        try {
            return await request(`/${product.apiId}`, method, body);
        } catch (error) {
            if (error.status === 404 && product.createdInSession) {
                throw new Error("DummyJSON не сохраняет добавленные товары на сервере, поэтому их нельзя изменить или удалить через API (HTTP 404). Для этих действий выберите товар из исходного каталога.");
            }
            throw error;
        }
    }

    function read() {
        return items.map((item) => ({ ...item }));
    }

    async function load() {
        const data = await request("?limit=0");
        if (!Array.isArray(data.products)) throw new Error("Сервер вернул неверный каталог.");
        const loaded = data.products.map(normalize);
        const ids = new Set();
        loaded.forEach((product) => {
            if (ids.has(product.id)) {
                throw new Error("Сервер вернул неверные идентификаторы товаров.");
            }
            ids.add(product.id);
        });
        items = loaded;
        ready = true;
        return read();
    }

    async function create(values) {
        assertReady();
        const submitted = { ...values, rating: 0 };
        validate(submitted);
        const response = await request("/add", "POST", payload(submitted));
        const product = { ...normalize(response), createdInSession: true };
        // DummyJSON возвращает один и тот же id при повторном POST.
        // id различает карточки, apiId всегда остаётся идентификатором из ответа API.
        if (items.some((item) => item.id === product.id)) {
            product.id = items.reduce((nextId, item) => Math.max(nextId, item.id + 1), 1);
        }
        items = [product, ...items];
        return { ...product };
    }

    async function update(id, values) {
        assertReady();
        const existing = items.find((item) => item.id === id);
        if (!existing) throw new Error("Товар не найден.");
        const submitted = { ...existing, ...values, rating: existing.rating };
        validate(submitted);
        const response = await mutate(existing, "PUT", payload(submitted));
        if (response?.id !== existing.apiId) throw new Error("DummyJSON вернул неверный идентификатор товара.");
        const product = { ...normalize(response), id, createdInSession: existing.createdInSession };
        items = items.map((item) => item.id === id ? product : item);
        return { ...product };
    }

    async function remove(id) {
        assertReady();
        const existing = items.find((item) => item.id === id);
        if (!existing) throw new Error("Товар не найден.");
        const response = await mutate(existing, "DELETE");
        if (response?.id !== existing.apiId || response.isDeleted !== true) {
            throw new Error("DummyJSON не подтвердил удаление товара.");
        }
        items = items.filter((item) => item.id !== id);
    }

    return { load, read, create, update, remove };
})();
