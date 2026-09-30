
const title = document.getElementById("title");
title.textContent = "Сәлем, әлем!";

const newDiv = document.createElement("div");
newDiv.classList.add("new-div");
newDiv.textContent = "Мен жаңа элементпін";


document.body.appendChild(newDiv);

const task1Content = document.getElementById("task1Content");


const oldElement = document.querySelector(".old-element");
oldElement.setAttribute("role", "button");
oldElement.setAttribute("tabindex", "0");
oldElement.setAttribute("aria-label", "Ескі элементті жою");
oldElement.addEventListener("click", function () {
    oldElement.remove();
});
oldElement.addEventListener("keydown", function (event) {
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        oldElement.remove();
    }
});

const paragraph = document.createElement("p");
paragraph.textContent = "Бұл ауыспалы абзац";
paragraph.classList.add("interactive-paragraph");
paragraph.setAttribute("role", "button");
paragraph.setAttribute("tabindex", "0");
paragraph.setAttribute("aria-pressed", "false");
task1Content.appendChild(paragraph);

function toggleParagraphStyle() {
    const isEmphasized = paragraph.classList.toggle("is-emphasized");
    paragraph.setAttribute("aria-pressed", String(isEmphasized));
}

const textToggleButton = document.getElementById("textToggleButton");
const originalTitle = "Бастапқы мәтін";
const greeting = "Сәлем, әлем!";
let showingGreeting = true;

textToggleButton.addEventListener("click", function () {
    showingGreeting = !showingGreeting;
    title.textContent = showingGreeting ? greeting : originalTitle;
    textToggleButton.setAttribute("aria-pressed", String(showingGreeting));
});

paragraph.addEventListener("click", toggleParagraphStyle);
paragraph.addEventListener("keydown", function (event) {
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleParagraphStyle();
    }
});
