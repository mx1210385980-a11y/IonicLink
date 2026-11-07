import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PredictionStudentWorkspace, PredictionTeacherWorkspace } from "./PredictionSubmissions";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const student = renderToStaticMarkup(createElement(PredictionStudentWorkspace));
assert.match(student, /data-testid="prediction-student-submission"/);
assert.match(student, /Capture current charts/);
assert.match(student, /Tuned model parameters/);
assert.match(student, /Reflection \/ comments/);
assert.match(student, /Submit to teacher/);
assert.match(student, /True vs Predicted/);
assert.doesNotMatch(student, /data-testid="prediction-teacher-inbox"/);

const teacher = renderToStaticMarkup(createElement(PredictionTeacherWorkspace));
assert.match(teacher, /data-testid="prediction-teacher-inbox"/);
assert.match(teacher, /Student reflections/);
assert.match(teacher, /every 5 seconds/);
assert.match(teacher, /True vs Predicted/);
assert.doesNotMatch(teacher, /data-testid="prediction-student-submission"/);

console.log("Prediction student capture panel and teacher inbox render tests passed");
