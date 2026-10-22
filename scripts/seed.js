/*
 * Adds a sample published examination so there's something to take right away.
 * It uses the 10 AI questions that were hardcoded in the old quiz.html,
 * so that content now lives in the database instead.
 *   npm run seed
 * Safe to run twice: it skips if a quiz with the same title exists.
 */
require("dotenv").config();

const mongoose = require("mongoose");
const Quiz = require("../models/Quiz");

const TITLE = "AI Fundamentals";

const questions = [
    ["What does AI stand for?", ["Artificial Intelligence", "Auto Input", "Advanced Internet", "None"], "Artificial Intelligence", "Easy"],
    ["What is Machine Learning?", ["AI subset", "Database", "OS", "Compiler"], "AI subset", "Easy"],
    ["Which language is best for AI?", ["Python", "C", "HTML", "CSS"], "Python", "Easy"],
    ["What is Neural Network?", ["Brain model", "Database", "Browser", "System"], "Brain model", "Medium"],
    ["NLP stands for?", ["Natural Language Processing", "Network Logic", "New Language", "None"], "Natural Language Processing", "Easy"],
    ["Which is supervised learning?", ["Regression", "Clustering", "PCA", "None"], "Regression", "Medium"],
    ["What is dataset?", ["Data collection", "Model", "Graph", "Code"], "Data collection", "Easy"],
    ["Deep Learning uses?", ["Neural networks", "SQL", "OS", "Files"], "Neural networks", "Medium"],
    ["AI is part of?", ["Computer Science", "Physics", "Math", "Chemistry"], "Computer Science", "Easy"],
    ["Example of ML?", ["Spam detection", "Paint", "OS", "Excel"], "Spam detection", "Medium"]
];

async function main() {
    await mongoose.connect(process.env.MONGO_URI);

    if (await Quiz.findOne({ title: TITLE })) {
        console.log(`"${TITLE}" already exists. Nothing to do.`);
        return mongoose.disconnect();
    }

    const quiz = new Quiz({
        title: TITLE,
        description: "Core ideas in artificial intelligence and machine learning.",
        category: "Computer Science",
        difficulty: "Easy",
        duration: 10,
        passingMarks: 16,
        negativeMarking: true,
        status: "published",
        instructions: [
            "The examination has 10 questions. Each carries 4 marks.",
            "A wrong answer deducts 1 mark. Unanswered questions score 0.",
            "Use Save & Next to move on, or jump to any question from the palette.",
            "Mark a question for review if you want to come back to it.",
            "The examination submits automatically when the timer reaches zero."
        ],
        questions: questions.map(([question, options, correct, difficulty]) => ({
            question, options, correct, difficulty, marks: 4, negativeMarks: 1, topic: "AI basics"
        }))
    });

    await quiz.save();
    console.log(`Created and published "${TITLE}" with ${quiz.questions.length} questions.`);
    await mongoose.disconnect();
}

main().catch(error => { console.error("Error:", error.message); process.exit(1); });
