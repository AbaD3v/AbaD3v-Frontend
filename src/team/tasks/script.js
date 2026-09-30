// Находим кнопки вкладок и области заданий
const tabs = document.querySelectorAll(".tab-button");
const taskPanels = document.querySelectorAll(".task-panel");

// Показываем задание, связанное с выбранной вкладкой
function showTask(tab) {
    // Сначала снимаем выделение со всех кнопок
    tabs.forEach(function (button) {
        button.classList.remove("selected");
        button.setAttribute("aria-selected", "false");
        button.tabIndex = -1;
    });

    // Скрываем все задания
    taskPanels.forEach(function (panel) {
        panel.hidden = true;
    });

    // Выделяем нажатую вкладку
    tab.classList.add("selected");
    tab.setAttribute("aria-selected", "true");
    tab.tabIndex = 0;

    // В data-target хранится ID нужной области
    const panelId = tab.dataset.target;
    document.getElementById(panelId).hidden = false;
}

// Назначаем обработчики каждой вкладке
tabs.forEach(function (tab, index) {
    tab.addEventListener("click", function () {
        showTask(tab);
    });

    // Вкладки можно переключать и стрелками клавиатуры
    tab.addEventListener("keydown", function (event) {
        let nextIndex;

        if (event.key === "ArrowRight") {
            nextIndex = (index + 1) % tabs.length;
        } else if (event.key === "ArrowLeft") {
            nextIndex = (index - 1 + tabs.length) % tabs.length;
        } else if (event.key === "Home") {
            nextIndex = 0;
        } else if (event.key === "End") {
            nextIndex = tabs.length - 1;
        } else {
            return;
        }

        event.preventDefault();
        showTask(tabs[nextIndex]);
        tabs[nextIndex].focus();
    });
});
