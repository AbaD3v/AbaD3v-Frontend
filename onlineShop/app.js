"use strict";
// Чтение и изменения каталога выполняются через productStore (catalog.js).
const $ = (id) => document.getElementById(id);
const money = (n) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
        n,
    );
const escapeHTML = (text) =>
    String(text).replace(
        /[&<>"']/g,
        (character) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[character],
    );
const labels = {
    beauty: "Красота",
    fragrances: "Парфюмерия",
    furniture: "Мебель",
    groceries: "Продукты",
    
    "home-decoration": "Декор",
    "kitchen-accessories": "Для кухни",
    laptops: "Ноутбуки",
    smartphones: "Смартфоны",
    "mobile-accessories": "Аксессуары",
    "mens-shirts": "Мужские рубашки",
    "mens-shoes": "Мужская обувь",
    "mens-watches": "Мужские часы",
    "womens-dresses": "Платья",
    "womens-bags": "Сумки",
    "womens-jewellery": "Украшения",
    "womens-shoes": "Женская обувь",
    "womens-watches": "Женские часы",
    "sports-accessories": "Спорт",
    sunglasses: "Очки",
    tablets: "Планшеты",
    tops: "Топы",
    vehicle: "Автомобили",
    motorcycle: "Мотоциклы",
    "skin-care": "Уход за кожей",
};
let products = [];
let cart = [];
let toastTimer;
let editingProductId = null;
let deletingProductId = null;
let productRequestPending = false;
let catalogLoading = false;

// SVG из установленного lucide-react: статической странице не нужен React runtime.
// Условия использования иконок: lucide-LICENSE.txt.
const iconPaths = {
    plus: '<path d="M5 12h14"></path><path d="M12 5v14"></path>',
    pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"></path><path d="m15 5 4 4"></path>',
    trash: '<path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>',
    x: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
};
const icon = (name) => `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${iconPaths[name]}</svg>`;
document.querySelectorAll("[data-icon]").forEach((element) => {
    element.innerHTML = icon(element.dataset.icon);
});
const placeholderImage = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240"><rect width="320" height="240" fill="#eef0f5"/><g fill="none" stroke="#9aa6bc" stroke-width="3" stroke-linejoin="round"><path d="m160 74 44 25v50l-44 25-44-25V99z"/><path d="m116 99 44 25 44-25m-44 25v50m-22-87 44 25"/></g></svg>');

// Корзина хранится только в браузере этого устройства.
try {
    const saved = JSON.parse(localStorage.getItem("nova-cart") || "[]");
    if (Array.isArray(saved)) {
        cart = saved
            .filter(
                (item) =>
                    item && Number.isSafeInteger(item.id) &&
                    typeof item.title === "string" &&
                    Number.isFinite(item.price) &&
                    item.price >= 0 &&
                    Number.isInteger(item.qty) &&
                    item.qty > 0 &&
                    Number.isInteger(item.stock) &&
                    item.stock > 0,
            )
            .map((item) => ({ ...item, qty: Math.min(item.qty, item.stock) }));
    }
} catch { }

function safeImage(url) {
    try {
        const parsedUrl = new URL(url);
        return parsedUrl.protocol === "https:" ? escapeHTML(parsedUrl.href) : placeholderImage;
    } catch {
        return placeholderImage;
    }
}

function notify(text) {
    $("toast").textContent = text;
    $("toast").style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($("toast").style.display = "none"), 2200);
}

function saveCart() {
    try {
        localStorage.setItem("nova-cart", JSON.stringify(cart));
    } catch { }
    renderCart();
}

function addProduct(id) {
    const product = products.find((item) => item.id === id);
    if (!product) throw new Error("Товар не найден");
    if (product.stock < 1) throw new Error("Товар закончился");

    const item = cart.find((cartItem) => cartItem.id === id);
    if (item && item.qty >= product.stock) {
        notify("Больше нет в наличии");
        return false;
    }

    if (item) {
        item.qty += 1;
    } else {
        cart.push({
            id: product.id,
            title: product.title,
            price: product.price,
            thumbnail: product.thumbnail,
            stock: product.stock,
            qty: 1,
        });
    }

    $("order-message").textContent = "";
    saveCart();
    notify("Товар добавлен в корзину");
    return true;
}

function renderProducts() {
    const query = $("search").value.trim().toLowerCase();
    const category = $("category").value;
    let list = products.filter(
        (product) =>
            (!category || product.category === category) &&
            (!query ||
                `${product.title} ${product.description} ${labels[product.category] || product.category}`
                    .toLowerCase()
                    .includes(query)),
    );

    const sort = $("sort").value;
    if (sort === "low") list.sort((a, b) => a.price - b.price);
    if (sort === "high") list.sort((a, b) => b.price - a.price);
    if (sort === "rating") list.sort((a, b) => b.rating - a.rating);

    $("result-count").textContent = `Найдено: ${list.length}`;
    $("status").textContent = list.length
        ? ""
        : products.length
            ? "Ничего не найдено. Попробуйте другое название или категорию."
            : "Каталог пока пуст. Нажмите «Добавить», чтобы создать первый товар.";
    $("products").innerHTML = list
        .map(
            (product) => `
        <article class="card">
          <div class="card-actions" role="group" aria-label="Управление товаром ${escapeHTML(product.title)}">
            <button type="button" class="icon-button" data-edit="${product.id}" aria-label="Редактировать товар: ${escapeHTML(product.title)}" title="Редактировать товар">${icon("pencil")}</button>
            <button type="button" class="icon-button delete-button" data-delete="${product.id}" aria-label="Удалить товар: ${escapeHTML(product.title)}" title="Удалить товар">${icon("trash")}</button>
          </div>
          <button class="image-button" data-detail="${product.id}" aria-label="Подробнее: ${escapeHTML(product.title)}">
            <img src="${safeImage(product.thumbnail)}" alt="${escapeHTML(product.title)}" loading="lazy">
            <span class="badge">${escapeHTML(labels[product.category] || product.category)}</span>
          </button>
          <div class="card-body">
            <span class="category-label">${escapeHTML(product.brand || "NOVA selection")}</span>
            <button class="title-button" data-detail="${product.id}">${escapeHTML(product.title)}</button>
            <div class="rating">
              <span>★</span> ${Number(product.rating).toFixed(1)} · ${product.stock > 0 ? "В наличии" : "Нет в наличии"}
            </div>
            <div class="card-bottom">
              <span class="price">${money(product.price)}</span>
              <button class="add" data-add="${product.id}" ${product.stock < 1 ? "disabled" : ""}>В корзину</button>
            </div>
          </div>
        </article>
      `,
        )
        .join("");
}

async function loadProducts() {
    if (catalogLoading) return;
    catalogLoading = true;
    $("status").textContent = "Загружаем товары…";
    $("retry").hidden = true;
    $("product-create").disabled = true;

    try {
        await productStore.load();
        refreshCatalog();
        $("product-create").disabled = false;
    } catch (error) {
        $("status").textContent =
            error.message || "Не удалось загрузить товары. Проверьте интернет и попробуйте ещё раз.";
        $("retry").hidden = false;
        $("result-count").textContent = "Каталог недоступен";
    } finally {
        catalogLoading = false;
    }
}

function renderCategories() {
    const selected = $("category").value;
    const categories = [...new Set(products.map((product) => product.category))];
    const options = (values) => values.map((category) =>
        `<option value="${escapeHTML(category)}">${escapeHTML(labels[category] || category)}</option>`,
    ).join("");
    $("category").innerHTML = '<option value="">Все категории</option>' + options(categories);
    $("category").value = categories.includes(selected) ? selected : "";
    $("product-category").innerHTML = '<option value="">Выберите категорию</option>' +
        options([...new Set([...Object.keys(labels), ...categories])]);
}

function refreshCatalog() {
    products = productStore.read();
    // Редактирование цены и остатка обновляет корзину, удаление убирает товар.
    const byId = new Map(products.map((product) => [product.id, product]));
    cart = cart.flatMap((item) => {
        const product = byId.get(item.id);
        return product && product.stock > 0
            ? [{ ...item, title: product.title, price: product.price, thumbnail: product.thumbnail,
                stock: product.stock, qty: Math.min(item.qty, product.stock) }]
            : [];
    });
    saveCart();
    renderCategories();
    renderProducts();
}

function showProductEditor(id = null) {
    const product = products.find((item) => item.id === id);
    if (id !== null && !product) return;
    editingProductId = id;
    $("product-form").reset();
    $("product-error").hidden = true;
    $("editor-title").textContent = product ? "Редактировать товар" : "Добавить товар";
    $("product-save").textContent = product ? "Сохранить изменения" : "Добавить товар";
    for (const field of ["title", "description", "category", "brand", "price", "stock", "thumbnail"]) {
        $("product-" + field).value = product?.[field] ?? (field === "stock" ? 1 : "");
    }
    if (!product) $("product-category").value = $("category").value;
    $("product-editor").showModal();
    $("product-title").focus();
}

function showDeleteProduct(id) {
    const product = products.find((item) => item.id === id);
    if (!product) return;
    deletingProductId = id;
    $("delete-product-name").textContent = product.title;
    $("delete-error").hidden = true;
    $("product-delete").showModal();
}

function setProductRequestPending(dialogId, pending) {
    productRequestPending = pending;
    $(dialogId).setAttribute("aria-busy", String(pending));
    $(dialogId).querySelectorAll("button, input, select, textarea").forEach((control) => {
        control.disabled = pending;
    });
}

for (const dialogId of ["product-editor", "product-delete"]) {
    $(dialogId).addEventListener("cancel", (event) => {
        if (productRequestPending) event.preventDefault();
    });
}

$("product-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (productRequestPending) return;
    const creating = editingProductId === null;
    const productId = editingProductId;
    const values = {
        title: $("product-title").value.trim(),
        description: $("product-description").value.trim(),
        category: $("product-category").value,
        brand: $("product-brand").value.trim(),
        price: $("product-price").valueAsNumber,
        stock: $("product-stock").valueAsNumber,
        thumbnail: $("product-thumbnail").value.trim(),
    };
    $("product-error").hidden = true;
    setProductRequestPending("product-editor", true);
    $("product-save").textContent = creating ? "Добавляем…" : "Сохраняем…";
    try {
        if (creating) await productStore.create(values);
        else await productStore.update(productId, values);
        // Сохранённый товар должен быть виден даже после поиска или смены категории.
        $("search").value = "";
        $("category").value = "";
        $("sort").value = "default";
        refreshCatalog();
        $("product-editor").close();
        $("product-create").focus();
        notify(creating ? "DummyJSON подтвердил добавление товара" : "DummyJSON подтвердил изменение товара");
    } catch (error) {
        $("product-error").textContent = error.message;
        $("product-error").hidden = false;
    } finally {
        setProductRequestPending("product-editor", false);
        $("product-save").textContent = creating ? "Добавить товар" : "Сохранить изменения";
    }
});

$("product-delete-confirm").addEventListener("click", async () => {
    if (deletingProductId === null || productRequestPending) return;
    const productId = deletingProductId;
    $("delete-error").hidden = true;
    setProductRequestPending("product-delete", true);
    $("product-delete-confirm").textContent = "Удаляем…";
    try {
        await productStore.remove(productId);
        refreshCatalog();
        $("product-delete").close();
        $("product-create").focus();
        notify("DummyJSON подтвердил удаление товара");
    } catch (error) {
        $("delete-error").textContent = error.message;
        $("delete-error").hidden = false;
    } finally {
        setProductRequestPending("product-delete", false);
        $("product-delete-confirm").innerHTML = `${icon("trash")} Удалить товар`;
    }
});

$("product-editor").addEventListener("close", () => { editingProductId = null; });
$("product-delete").addEventListener("close", () => { deletingProductId = null; });
$("product-create").addEventListener("click", () => showProductEditor());

document.addEventListener("error", (event) => {
    if (event.target instanceof HTMLImageElement && event.target.getAttribute("src") !== placeholderImage) {
        event.target.src = placeholderImage;
    }
}, true);

function showDetails(id) {
    const product = products.find((item) => item.id === id);
    if (!product) return;

    $("detail-content").innerHTML = `
    <img class="detail-img" src="${safeImage(product.thumbnail)}" alt="${escapeHTML(product.title)}">
    <p class="eyebrow">${escapeHTML(labels[product.category] || product.category)}</p>
    <h2>${escapeHTML(product.title)}</h2>
    <p class="description">${escapeHTML(product.description)}</p>
    <p>Рейтинг: ${product.rating} / 5 · Остаток: ${product.stock}</p>
    <div class="detail-actions">
      <strong class="price">${money(product.price)}</strong>
      <button class="primary" data-add="${product.id}" ${product.stock < 1 ? "disabled" : ""}>В корзину</button>
    </div>
  `;
    $("details").showModal();
}

function renderCart() {
    $("cart-count").textContent = cart.reduce((sum, item) => sum + item.qty, 0);
    $("cart-total").textContent = money(
        cart.reduce((sum, item) => sum + item.price * item.qty, 0),
    );
    $("checkout").disabled = !cart.length;
    $("cart-items").innerHTML = cart.length
        ? cart
            .map(
                (item) => `
            <div class="cart-row">
              <img src="${safeImage(item.thumbnail)}" alt="${escapeHTML(item.title)}">
              <div>
                <h3>${escapeHTML(item.title)}</h3>
                <span>${money(item.price)} · Сумма ${money(item.price * item.qty)}</span>
                <div class="quantity">
                  <button data-change="${item.id}" data-delta="-1" aria-label="Уменьшить количество ${escapeHTML(item.title)}">−</button>
                  <span>${item.qty}</span>
                  <button data-change="${item.id}" data-delta="1" ${item.qty >= item.stock ? "disabled" : ""} aria-label="Увеличить количество ${escapeHTML(item.title)}">+</button>
                  <button class="remove" data-remove="${item.id}">Удалить</button>
                </div>
              </div>
            </div>
          `,
            )
            .join("")
        : '<p class="description">Корзина пока пуста. Выберите товары в каталоге.</p>';
}

document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;

    if (button.dataset.add) addProduct(Number(button.dataset.add));
    if (button.dataset.detail) showDetails(Number(button.dataset.detail));
    if (button.dataset.edit) showProductEditor(Number(button.dataset.edit));
    if (button.dataset.delete) showDeleteProduct(Number(button.dataset.delete));
    if (button.dataset.close) $(button.dataset.close).close();

    if (button.dataset.remove) {
        cart = cart.filter((item) => item.id !== Number(button.dataset.remove));
        saveCart();
    }

    if (button.dataset.change) {
        const item = cart.find(
            (cartItem) => cartItem.id === Number(button.dataset.change),
        );
        if (item) {
            item.qty = Math.min(item.stock, item.qty + Number(button.dataset.delta));
            cart = cart.filter((cartItem) => cartItem.qty > 0);
            saveCart();
        }
    }
});

["search", "category", "sort"].forEach((id) =>
    $(id).addEventListener(id === "search" ? "input" : "change", renderProducts),
);

$("retry").addEventListener("click", loadProducts);
$("cart-open").addEventListener("click", () => $("cart").showModal());
$("checkout").addEventListener("click", () => {
    if (!cart.length) return;

    const total = money(
        cart.reduce((sum, item) => sum + item.price * item.qty, 0),
    );
    cart = [];
    saveCart();
    $("order-message").textContent =
        `Учебный заказ на ${total} оформлен! Это демонстрация: деньги не списаны, товары не будут отправлены.`;
});

// Необязательный браузерный API для агента: используется та же функция корзины.
if (document.modelContext?.registerTool) {
    try {
        Promise.resolve(
            document.modelContext.registerTool({
                name: "add_product_to_cart",
                description:
                    "Добавить один товар из загруженного каталога в локальную корзину.",
                inputSchema: {
                    type: "object",
                    properties: { productId: { type: "integer" } },
                    required: ["productId"],
                    additionalProperties: false,
                },
                annotations: { readOnlyHint: false },
                execute: (input) => {
                    if (!input || !Number.isInteger(input.productId)) {
                        throw new Error("Нужен целочисленный productId");
                    }
                    return {
                        added: addProduct(input.productId),
                        count: cart.reduce((sum, item) => sum + item.qty, 0),
                    };
                },
            }),
        ).catch(() => { });
    } catch { }
}

renderCart();
loadProducts();
