// Находим элементы на странице
const rowsInput = document.querySelector("#rows");
const columnsInput = document.querySelector("#columns");
const createButton = document.querySelector("#createButton");
const themeButton = document.querySelector("#themeButton");
const table = document.querySelector("#table");
const counter = document.querySelector("#counter");

// Функция создания таблицы
function createTable(rows, columns) {
    // Удаляем содержимое предыдущей таблицы
    table.innerHTML = "";

    // Создаём строки
    for (let i = 0; i < rows; i++) {
        const row = document.createElement("tr");

        // В каждой строке создаём ячейки
        for (let j = 0; j < columns; j++) {
            const cell = document.createElement("td");
            cell.textContent = "Жми";

            // Действие при нажатии на ячейку
            cell.addEventListener("click", function () {
                cell.classList.toggle("colored");
                countColoredCells();
            });

            // Добавляем ячейку в строку
            row.appendChild(cell);
        }

        // Добавляем готовую строку в таблицу
        table.appendChild(row);
    }

    // После создания новой таблицы обновляем счётчик
    countColoredCells();
}

// Функция подсчёта жёлтых ячеек
function countColoredCells() {
    const coloredCells = table.querySelectorAll(".colored");
    counter.textContent = coloredCells.length;
}

// Нажатие кнопки создания таблицы
createButton.addEventListener("click", function () {
    const rows = Number(rowsInput.value);
    const columns = Number(columnsInput.value);

    // Проверяем введённые значения
    if (
        !Number.isInteger(rows) ||
        !Number.isInteger(columns) ||
        rows <= 0 ||
        columns <= 0
    ) {
        alert("Введите целые числа больше нуля.");
        return;
    }

    createTable(rows, columns);
});

// Переключение темы
themeButton.addEventListener("click", function () {
    document.body.classList.toggle("dark");
});