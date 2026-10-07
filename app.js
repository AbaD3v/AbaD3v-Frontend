"use strict";
// Frontend получает каталог с готового Backend API DummyJSON.
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

// Корзина хранится только в браузере этого устройства.
try {
    const saved = JSON.parse(localStorage.getItem("nova-cart") || "[]");
    if (Array.isArray(saved)) {
        cart = saved
            .filter(
                (item) =>
                    Number.isInteger(item.id) &&
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
        return parsedUrl.protocol === "https:" ? escapeHTML(parsedUrl.href) : "";
    } catch {
        return "";
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
        : "Ничего не найдено. Попробуйте другое название или категорию.";
    $("products").innerHTML = list
        .map(
            (product) => `
        <article class="card">
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
    $("status").textContent = "Загружаем товары…";
    $("retry").hidden = true;

    try {
        const response = await fetch("https://dummyjson.com/products?limit=0", {
            signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error("HTTP " + response.status);

        const data = await response.json();
        if (!Array.isArray(data.products)) throw new Error("Неверный ответ");

        products = data.products;
        const categories = [
            ...new Set(products.map((product) => product.category)),
        ];
        $("category").innerHTML =
            '<option value="">Все категории</option>' +
            categories
                .map(
                    (category) =>
                        `<option value="${escapeHTML(category)}">${escapeHTML(labels[category] || category)}</option>`,
                )
                .join("");

        renderProducts();
    } catch {
        $("status").textContent =
            "Не удалось загрузить товары. Проверьте интернет и попробуйте ещё раз.";
        $("retry").hidden = false;
        $("result-count").textContent = "Каталог недоступен";
    }
}

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
