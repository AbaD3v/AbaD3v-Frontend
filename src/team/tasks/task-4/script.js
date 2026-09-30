// Находим кнопку
const themeButton = document.getElementById("themeButton");

// Каждое нажатие добавляет или удаляет класс dark
themeButton.addEventListener("click", function () {
    document.body.classList.toggle("dark");
});
