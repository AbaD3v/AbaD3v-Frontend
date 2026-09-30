// Находим элементы страницы
const rowsInput = document.querySelector("#rows");
const columnsInput = document.querySelector("#columns");
const createButton = document.querySelector("#createButton");
const table = document.querySelector("#table");
const counter = document.querySelector("#counter");

function createTable(rows, columns) {
    table.innerHTML = "";

    for (let i = 0; i < rows; i++) {
        const row = document.createElement("tr");

        for (let j = 0; j < columns; j++) {
            const cell = document.createElement("td");
            cell.textContent = "Бас";

            cell.addEventListener("click", function () {
                cell.classList.toggle("colored");
                countColoredCells();
            });

            row.appendChild(cell);
        }

        table.appendChild(row);
    }

    countColoredCells();
}

function countColoredCells() {
    const coloredCells = table.querySelectorAll(".colored");
    counter.textContent = coloredCells.length;
}

createButton.addEventListener("click", function () {
    const rows = Number(rowsInput.value);
    const columns = Number(columnsInput.value);

    if (
        !Number.isInteger(rows) ||
        !Number.isInteger(columns) ||
        rows <= 0 ||
        columns <= 0
    ) {
        alert("Нөлден үлкен бүтін сандарды енгізіңіз.");
        return;
    }

    createTable(rows, columns);
});
