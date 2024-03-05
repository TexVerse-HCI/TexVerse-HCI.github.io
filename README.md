This is the front-end webapp of the TexVerse project 🧶.
# Featuring
- Get data of HCI textile research paper from the Firebase firestore data base (with an initial amount of 220 relevant papers, which is scraped from the ACM digital library on Feb, 2024). You can also apply filter to paper with several metadata.
    - With the card (gallery) view of papers, you can gain a quick glimpse of all relevant papers all at once. The _teaser image_ part meant to serve as the "memory landmard" for each paper (you see the image, and you recall details on that paper. It works better than titles sometimes).
- After logging in, you can collect papers 🌟.
- Chat with the TexVerse AI bot! It's equipped with all the paper text data (content in the paper's pdfs!) and now an expert in HCI textile research.
    - Using RAG, the app will fetch most relevant context extracted from all the papers (the paper content text was chunked based on paragraphs) and feed to the prompt with your question.

1213

### DOIs of the most relevant papers:
https://doi.org/10.1145/3559400.3562001\nhttps://doi.org/10.1145/3559400.3562002\nhttps://doi.org/10.1145/3559400.3562003\nhttps://doi.org/10.1145/3559400.3562004\nhttps://doi.org/10.1145/3559400.3562005'

# Lessons Learned
- __D3 bursh__. One of the new features I learned with D3 is its [brush](https://d3js.org/d3-brush), with which you can brush to select a region. You can also customize [snapping effects](https://observablehq.com/@d3/brush-snapping-transitions). _Its really smooth_!
- Other lessons can be found in the README of the _Python Scraper_ repository or the README of this _organization_,