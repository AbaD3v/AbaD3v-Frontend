// Находим элемент, кнопку и абзац для вывода
const classElement = document.getElementById("classElement");
const toggleButton = document.getElementById("toggleButton");
const classesOutput = document.getElementById("classesOutput");

function showClasses() {
    const classesArray = Array.from(classElement.classList);
    const classesText = classesArray.join(", ");
    console.log(classesText);
    classesOutput.textContent = "Кластар: " + classesText;
}

toggleButton.addEventListener("click", function () {
    classElement.classList.toggle("active");
    showClasses();
});

showClasses();
