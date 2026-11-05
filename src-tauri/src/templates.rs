use std::fs;
use std::path::Path;

use crate::error::{AppError, AppResult};

const ARTICLE: &str = r#"\documentclass[12pt]{article}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage{hyperref}

\title{My LaTeX Document}
\author{Your Name}
\date{\today}

\begin{document}
\maketitle
\tableofcontents

\section{Introduction}
Start writing here. This project is stored locally and compiles with the TeX engine you select.

\section{Mathematics}
A short example:
\begin{equation}
  E = mc^2
\end{equation}

\section{Lists}
\begin{itemize}
  \item First point
  \item Second point
\end{itemize}

\end{document}
"#;

const REPORT: &str = r#"\documentclass[12pt]{report}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage{hyperref}

\title{Project Report}
\author{Your Name}
\date{\today}

\begin{document}
\maketitle
\tableofcontents

\chapter{Overview}
Describe the purpose and scope of the report.

\chapter{Method}
Explain the approach, data, and tools used.

\chapter{Results}
Present the findings with tables and figures.

\chapter{Conclusion}
Summarize what was learned.

\end{document}
"#;

const THESIS_MAIN: &str = r#"\documentclass[12pt,openany]{report}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage{hyperref}

\title{My Thesis}
\author{Your Name}
\date{\today}

\begin{document}
\maketitle
\tableofcontents

\include{chapters/introduction}
\include{chapters/methods}
\include{chapters/conclusion}

\end{document}
"#;

const THESIS_INTRO: &str = r#"\chapter{Introduction}
Introduce the research question, motivation, and context.

\section{Problem statement}
State the problem clearly.

\section{Objectives}
\begin{itemize}
  \item First objective
  \item Second objective
\end{itemize}
"#;

const THESIS_METHODS: &str = r#"\chapter{Methods}
\section{Research design}
Describe the design of the study.

\section{Data collection}
Explain how the data was collected.

\section{Analysis}
Describe the analysis procedure.
"#;

const THESIS_CONCLUSION: &str = r#"\chapter{Conclusion}
Summarize the main findings and their implications.

\section{Future work}
Suggest directions for further research.
"#;

const BEAMER: &str = r#"\documentclass{beamer}
\usetheme{Madrid}
\usecolortheme{default}

\title{Presentation Title}
\author{Your Name}
\date{\today}

\begin{document}

\begin{frame}
  \titlepage
\end{frame}

\begin{frame}{Outline}
  \tableofcontents
\end{frame}

\section{Introduction}
\begin{frame}{Why this topic?}
  \begin{itemize}
    \item First idea
    \item Second idea
  \end{itemize}
\end{frame}

\begin{frame}{A formula}
  \begin{equation}
    E = mc^2
  \end{equation}
\end{frame}

\end{document}
"#;

const BOOK: &str = r#"\documentclass[11pt,openany]{book}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage{hyperref}

\title{A Book Title}
\author{Your Name}
\date{\today}

\begin{document}
\frontmatter
\maketitle
\tableofcontents

\mainmatter
\part{First Part}
\include{chapters/chapter1}
\include{chapters/chapter2}

\backmatter
\chapter{Afterword}
Close the book with a short afterword.

\end{document}
"#;

const BOOK_CHAPTER_1: &str = r#"\chapter{The Beginning}
Start the first chapter here. The book template splits chapters into separate files so the
document stays readable as it grows.

\section{An opening scene}
Describe the setting.

\section{A first idea}
Develop the argument or narrative.
"#;

const BOOK_CHAPTER_2: &str = r#"\chapter{The Next Step}
Add the next chapter here.

\begin{equation}
  E = mc^2
\end{equation}
"#;

const LETTER: &str = r#"\documentclass[11pt]{letter}\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}

\signature{Your Name}
\address{Your Street 1\\12345 Your City}

\begin{document}

\begin{letter}{Recipient Name\\Recipient Street 2\\54321 Recipient City}
\opening{Dear Recipient,}

Write your letter here.

\closing{Sincerely,}
\end{letter}

\end{document}
"#;

const BLANK: &str = r#"\documentclass{article}
\begin{document}
Hello, world.
\end{document}
"#;

const README: &str = r#"# LaTeX project

Open this folder in LaTeX Studio, edit the source files, and compile.

- Main file: `main.tex`
- Build output is kept in `.latexstudio/build` and is excluded from the file tree.
"#;

pub fn write_template(template: &str, target: &Path) -> AppResult<()> {
    let files: Vec<(&str, &str)> = match template {
        "article" => vec![("main.tex", ARTICLE), ("README.md", README)],
        "report" => vec![("main.tex", REPORT), ("README.md", README)],
        "thesis" => vec![
            ("main.tex", THESIS_MAIN),
            ("chapters/introduction.tex", THESIS_INTRO),
            ("chapters/methods.tex", THESIS_METHODS),
            ("chapters/conclusion.tex", THESIS_CONCLUSION),
            ("README.md", README),
        ],
        "beamer" => vec![("main.tex", BEAMER), ("README.md", README)],
        "letter" => vec![("main.tex", LETTER), ("README.md", README)],
        "book" => vec![
            ("main.tex", BOOK),
            ("chapters/chapter1.tex", BOOK_CHAPTER_1),
            ("chapters/chapter2.tex", BOOK_CHAPTER_2),
            ("README.md", README),
        ],
        "blank" => vec![("main.tex", BLANK), ("README.md", README)],
        _ => {
            return Err(AppError::new(
                "invalid_template",
                "Unknown project template",
            ))
        }
    };
    for (rel, content) in files {
        let path = target.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| AppError::io("Could not create template folder", e))?;
        }
        fs::write(&path, content).map_err(|e| AppError::io("Could not write template file", e))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_every_template() {
        for id in ["article", "report", "thesis", "beamer", "letter", "book", "blank"] {
            let dir = tempfile::tempdir().unwrap();
            write_template(id, dir.path()).unwrap();
            assert!(dir.path().join("main.tex").is_file(), "template {id}");
        }
    }

    #[test]
    fn rejects_unknown_template() {
        let dir = tempfile::tempdir().unwrap();
        assert!(write_template("nope", dir.path()).is_err());
    }

    #[tokio::test]
    #[ignore = "requires Tectonic and a network connection on first run"]
    async fn book_template_compiles_with_tectonic() {
        if crate::tools::find_tool("tectonic").is_none() {
            eprintln!("Tectonic not installed; skipping");
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        write_template("book", &root).unwrap();
        let state = crate::state::AppState::new();
        let result = crate::compiler::compile(
            &root,
            "main.tex",
            "tectonic",
            &crate::models::CompileSettings::default(),
            &state,
        )
        .await
        .unwrap();
        assert!(
            result.success,
            "book template failed to compile:\n{}\n{:?}",
            result.logs, result.diagnostics
        );
        assert!(result.pdf_path.is_some());
    }
}
