// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore, collection, getDoc, getDocs, setDoc, updateDoc, doc, query, orderBy, where, startAfter, limit } from "firebase/firestore";
import { getStorage, ref, getDownloadURL } from "firebase/storage";
import { getAuth, signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import * as d3 from "d3";
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import './style.css';
import marked from 'marked';

import showdown from 'showdown';

// Create a converter instance
const converter = new showdown.Converter();

// login status
let loginStatus = false;
let currentPage = "gallery"; // default page is collection
let userID = null;
let collectionList = []; // list of collections for the current user

let lastVisible = null; // global variable to store the last visible document
let isLoading = false; // track if it's loading
let allDataLoaded = false; // track if all data is loaded
let sortOption = "latest"; // default sort option
let filterOption = { "keywords": [], "authors": [], "year": [], "contentType": [] }; // default filter option
let curretnFilter = null; // current filter; users can apply only one filter at a time

// navigation bar update based on the current page
document.querySelectorAll('.nav-item .nav-link').forEach(link => {
  link.addEventListener('click', function (event) {
    event.preventDefault(); // Prevent the default anchor link behavior
    const page = this.getAttribute('href').substring(1); // Remove '#' to get the page name
    currentPage = page; // Set currentPage variable to the extracted page name
    console.log(currentPage); // For testing purposes
    if (currentPage == "gallery") {
      document.querySelector('.sidebar-nav').style.display = 'block';
      addClickToCollectionIcon();
    }
    else {
      document.querySelector('.sidebar-nav').style.display = 'none';
      // Clear existing papers
      document.getElementById('collectionsContainer').innerHTML = '';
      loadCollectionsPapers();
    }
  });
});

// highlight the filter span (one time can only highlight one filter span)
function highlightFilterSpan(spanId) {
  const filterSpans = ['dateFilterSpan', 'keywordsFilterSpan', 'authorsFilterSpan', 'contentTypeFilterSpan'];

  if (spanId == null) // no filter is selected
  {
    filterSpans.forEach(span => {
      document.getElementById(span).style.fontWeight = 'normal';
      document.getElementById(span).style.textDecoration = 'none';
    });
  }
  else {
    filterSpans.forEach(span => {
      if (span === spanId) {
        document.getElementById(span).style.fontWeight = 'bold';
        document.getElementById(span).style.textDecoration = 'underline';
      } else {
        document.getElementById(span).style.fontWeight = 'normal';
        document.getElementById(span).style.textDecoration = 'none';
      }
    });

    if (spanId == 'dateFilterSpan') {
      // 🛑🛑🛑🛑 firestore limitation, the order and filter must be on the same field
      document.getElementById('citationOrder').classList.add('disabled');
      document.getElementById('downloadOrder').classList.add('disabled');
    }
    else {
      document.getElementById('citationOrder').classList.remove('disabled');
      document.getElementById('downloadOrder').classList.remove('disabled');
    }
  }

}

// draw the date bar chart for sidebar
function drawSideBarDateBarChart(dateData) {
  // Convert dateData object to an array of objects
  const dataArray = Object.keys(dateData).map(year => ({
    year: year,
    count: dateData[year]
  }));

  const sidebarLink = document.querySelector('#date').parentNode.querySelector('.sidebar-link');
  const sidebarLinkStyle = window.getComputedStyle(sidebarLink);
  const sidebarLinkPaddingLeft = parseInt(sidebarLinkStyle.paddingLeft, 10);
  const sidebarLinkPaddingRight = parseInt(sidebarLinkStyle.paddingRight, 10);
  const sidebarLinkWidth = sidebarLink.clientWidth - sidebarLinkPaddingLeft - sidebarLinkPaddingRight;

  // Set dimensions and margins for the graph
  const margin = { top: 20, right: 20, bottom: 30, left: 20 },
    width = sidebarLinkWidth - margin.left - margin.right,
    height = 200 - margin.top - margin.bottom;

  // Append SVG object to the body, set dimensions
  const svg = d3.select("#date").append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom)
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // X axis
  const x = d3.scaleBand()
    .range([0, width])
    .domain(dataArray.map(d => d.year))
    .padding(0.1);

  // Y axis
  const y = d3.scaleLinear()
    .domain([0, d3.max(dataArray, d => d.count)])
    .range([height, 0]);
  svg.append("g")
    .call(d3.axisLeft(y).ticks(4))
    .call(g => g.select(".domain").remove()) // Remove the axis line
    .call(g => g.select(".tick").remove()) // Remove the zero tick lines
    .call(g => g.selectAll(".tick line") // Add the grid lines
      .attr("stroke-opacity", 0.1))
    .call(g => g.selectAll(".tick line").clone()
      .attr("x2", width)
      .attr("stroke-opacity", 0.1));

  svg.selectAll(".bar")
    .data(dataArray)
    .enter().append("rect")
    .attr("class", "bar")
    .attr("x", d => x(d.year))
    .attr("y", d => y(d.count))
    .attr("width", x.bandwidth())
    .attr("height", d => height - y(d.count))
    .attr("fill", "#212121")
    .on("mouseover", function (event, d) {
      const [mouseX, mouseY] = d3.pointer(event, this);
      console.log(mouseX, mouseY);
      d3.select("#sidebarDateBarChartTooltip")
        .style("opacity", 1)
        .html(`${d.year} (${d.count})`)
        .style("left", `${mouseX}px`) // Smaller offset to the right of the cursor
        .style("top", `${mouseY + 30}px`); // Smaller offset below the cursor
    })
    .on("mouseout", function () {
      d3.select("#sidebarDateBarChartTooltip").style("opacity", 0);
    });

  const brush = d3.brushX()
    .extent([[0, 0], [width, height]])
    .on("end", brushended)
    .on("brush", brushing);

  // year range selection tooltip
  let yearTooltip = svg.append("g")
    .attr("transform", `translate(0,${height})`);
  let yearStart = yearTooltip.append("text")
    .attr("x", 0)
    .attr("y", 12)
    .attr("text-anchor", "end") // Anchor the text at the end
    .attr("fill", "#000")
    .style("font-size", "12px")
    .style("opacity", 0)
    .text(""); // Text content
  let yearEnd = yearTooltip.append("text")
    .attr("x", 20)
    .attr("y", 12)
    .attr("text-anchor", "start") // Anchor the text at the start
    .attr("fill", "#000")
    .style("font-size", "12px")
    .style("opacity", 0)
    .text("");

  // when the brush is ended, handle the selection snap and text update
  function brushended(event) {
    const selection = event.selection;
    if (!event.sourceEvent || !selection) return;

    // If the selection is empty, hide the year range text
    if (event.selection) {
      yearStart.style("opacity", 1);
      yearEnd.style("opacity", 1);
    }
    else {
      yearStart.style("opacity", 0);
      yearEnd.style("opacity", 0);
    }

    // Convert pixel positions to domain values
    const domainValues = x.domain();
    const rangeValues = x.range();
    const rangeStep = x.step(); // Distance between each band

    // Find nearest domain value for start and end of selection
    const startIndex = Math.round((selection[0] - x.bandwidth() * x.paddingInner() / 2) / rangeStep);
    const endIndex = Math.round((selection[1] - x.bandwidth() * x.paddingInner() / 2) / rangeStep);

    // Update the text to show the selected year range
    yearStart.text(yearList[startIndex]);
    yearEnd.text(yearList[endIndex - 1]);

    // apply the filter
    curretnFilter = "year";
    filterOption.year = [yearList[startIndex], yearList[endIndex - 1]];

    // 🌟 highlight the date filter span
    highlightFilterSpan('dateFilterSpan');

    // restart the load
    // Clear existing papers
    if (currentPage == "gallery") {
      document.getElementById('papersContainer').innerHTML = '';
    }
    else if (currentPage == "collections") {
      document.getElementById('collectionsContainer').innerHTML = '';
    }
    // Reset variables
    lastVisible = null;
    isLoading = false;
    allDataLoaded = false;
    // Reload papers based on the selected sort option
    loadPapers(sortOption, filterOption, curretnFilter).catch(console.error);


    // update text opacity
    if (startIndex == endIndex) {
      yearStart.style("opacity", 0);
      yearEnd.style("opacity", 0);
    }
    // update the text position
    if (endIndex - startIndex > 1) {
      yearStart.style("opacity", 1);
      yearEnd.style("opacity", 1);
      yearStart.attr("text-anchor", "end");
      yearStart.attr("x", x(domainValues[Math.max(0, Math.min(domainValues.length - 1, startIndex))]) + x.bandwidth());
      yearEnd.attr("x", x(domainValues[Math.max(0, Math.min(domainValues.length - 1, endIndex))]) + (endIndex == domainValues.length ? x.bandwidth() : 0) - x.bandwidth());
    }
    else if (endIndex - startIndex == 1) {
      yearStart.style("opacity", 1);
      yearEnd.style("opacity", 0);
      yearStart.attr("text-anchor", "middle");
      yearStart.attr("x", x(domainValues[Math.max(0, Math.min(domainValues.length - 1, startIndex))]) + x.bandwidth() / 2);
    } else {
      yearStart.style("opacity", 0);
      yearEnd.style("opacity", 0);
    }
    // Update the selection to snap to the nearest year
    const newSelection = [
      x(domainValues[Math.max(0, Math.min(domainValues.length - 1, startIndex))]),
      x(domainValues[Math.max(0, Math.min(domainValues.length - 1, endIndex))]) + (endIndex == domainValues.length ? x.bandwidth() : 0)
    ];
    d3.select(this).transition().call(brush.move, newSelection.length ? newSelection : null);
  }

  // when the brush is brushing, handle the text update
  function brushing(event) {
    const selection = event.selection;
    if (!event.sourceEvent || !selection) return;

    // If the selection is empty, hide the year range text
    if (event.selection) {
      yearStart.style("opacity", 1);
      yearEnd.style("opacity", 1);
    }
    else {
      yearStart.style("opacity", 0);
      yearEnd.style("opacity", 0);
    }


    // Convert pixel positions to domain values
    const domainValues = x.domain();
    const rangeValues = x.range();
    const rangeStep = x.step(); // Distance between each band

    // Find nearest domain value for start and end of selection
    const startIndex = Math.round((selection[0] - x.bandwidth() * x.paddingInner() / 2) / rangeStep);
    const endIndex = Math.round((selection[1] - x.bandwidth() * x.paddingInner() / 2) / rangeStep);

    // Update the text to show the selected year range
    yearStart.text(yearList[startIndex]);
    yearEnd.text(yearList[endIndex - 1]);

    // update the text position
    if (endIndex - startIndex > 1) {
      yearStart.style("opacity", 1);
      yearEnd.style("opacity", 1);
      yearStart.attr("text-anchor", "end");
      yearStart.attr("x", x(domainValues[Math.max(0, Math.min(domainValues.length - 1, startIndex))]) + x.bandwidth());
      yearEnd.attr("x", x(domainValues[Math.max(0, Math.min(domainValues.length - 1, endIndex))]) + (endIndex == domainValues.length ? x.bandwidth() : 0) - x.bandwidth());
    }
    else if (endIndex - startIndex == 1) {
      yearStart.style("opacity", 1);
      yearEnd.style("opacity", 0);
      yearStart.attr("text-anchor", "middle");
      yearStart.attr("x", x(domainValues[Math.max(0, Math.min(domainValues.length - 1, startIndex))]) + x.bandwidth() / 2);
    } else {
      yearStart.style("opacity", 0);
      yearEnd.style("opacity", 0);
    }
  }

  svg.append("g")
    .call(brush)
    .call(
      g => g.select(".overlay")
        .on("mousedown", () => {
          yearStart.style("opacity", 0);
          yearEnd.style("opacity", 0);
        })
    );
}

// update the sidebar with the data from the server
function updateSidebar(sidebarData) {
  // Add the sidebar dropdowns
  let sidebarList = ["keywords", "authors", "contentType"];
  sidebarList.forEach(function (item) {
    var sidebarItem = document.querySelector(`[data-bs-target="#${item}"]`);
    var newList = document.createElement('ul');
    newList.id = item;
    newList.className = 'sidebar-dropdown list-unstyled collapse';
    // newList.setAttribute('data-bs-parent', '#sidebar');
    Object.keys(sidebarData[item]).forEach(function (subItem) {
      var listItem = document.createElement('li');
      listItem.className = 'sidebar-item';
      var link = document.createElement('a');
      link.href = '#';
      link.className = `sidebar-link sidebar-tag sidebar-link-sub tag-name-${subItem.replace(/\s+/g, "-")}`; // tag-name: replace space with dash (e.g. "Stanford University" -> "Stanford-University")
      link.textContent = subItem + " (" + sidebarData[item][subItem] + ")";
      listItem.appendChild(link);
      newList.appendChild(listItem);
    });
    sidebarItem.parentNode.insertBefore(newList, sidebarItem.nextSibling);
  });

  // Call drawDateBarChart for the "date" dimension specifically
  if (sidebarData.date) {
    drawSideBarDateBarChart(sidebarData.date);
    yearList = Object.keys(sidebarData.date);
    // console.log(yearList);

  }

  // Add tag, remove tag and toggle tag selection logic
  document.querySelectorAll('.sidebar-tag').forEach(item => {
    item.addEventListener('click', function (e) {
      e.preventDefault();

      this.classList.toggle('sidebar-tag-selected');
      this.classList.toggle('sidebar-link');

      const tagName = this.textContent.match(/^(.+?)\s\(\d+\)$/)[1];

      if (this.classList.contains('sidebar-tag-selected')) {
        const category = this.parentNode.parentNode.id;

        // 🌟 highlight the filter span
        highlightFilterSpan(`${category}FilterSpan`);
        curretnFilter = category;

        // Add tag to filterOption
        if (!(tagName in filterOption[category])) {
          filterOption[category].push(tagName);
        }

        // restart the load
        // Clear existing papers
        if (currentPage == "gallery") {
          document.getElementById('papersContainer').innerHTML = '';
        }
        else if (currentPage == "collections") {
          document.getElementById('collectionsContainer').innerHTML = '';
        }

        // Reset variables
        lastVisible = null;
        isLoading = false;
        allDataLoaded = false;
        // Reload papers based on the selected sort option
        loadPapers(sortOption, filterOption, curretnFilter).catch(console.error);

        console.log(filterOption);

      } else {
        const category = this.parentNode.parentNode.id;
        filterOption[category] = filterOption[category].filter(item => item !== tagName);

        // 🌟 highlight the filter span
        if (filterOption[category].length != 0) // if there are still tags selected
        {
          highlightFilterSpan(`${category}FilterSpan`);
          curretnFilter = category;
        }
        else // if no tags are selected
        {
          highlightFilterSpan(null);
          curretnFilter = null;
        }

        // restart the load
        // Clear existing papers
        if (currentPage == "gallery") {
          document.getElementById('papersContainer').innerHTML = '';
        }
        else if (currentPage == "collections") {
          document.getElementById('collectionsContainer').innerHTML = '';
        }

        // Reset variables
        lastVisible = null;
        isLoading = false;
        allDataLoaded = false;
        // Reload papers based on the selected sort option
        loadPapers(sortOption, filterOption, curretnFilter).catch(console.error);

        console.log(filterOption);
      }
    });
  });
}


// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAxMMgHycC0Ta6RCbL1UDkxuFmteA6_Cxo",
  authDomain: "hci-textile.firebaseapp.com",
  databaseURL: "https://hci-textile-default-rtdb.firebaseio.com",
  projectId: "hci-textile",
  storageBucket: "hci-textile.appspot.com",
  messagingSenderId: "908529674220",
  appId: "1:908529674220:web:2c07c447a1cdbdf36202c9",
  measurementId: "G-P4G9RBBKRG"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

const db = getFirestore(app);   // Get a reference to the database service
const storage = getStorage(app); // Get a reference to the storage service

var yearList; // global variable to store the year list
// load sidebar data, based on realtime data from the firebase database
document.addEventListener('DOMContentLoaded', function () {
  let paperQuery;
  paperQuery = query(collection(db, 'paper'));
  async function fetchData() {
    let paperQuery;
    paperQuery = query(collection(db, 'paper'));
    const querySnapshot = await getDocs(paperQuery);

    // find top 5 most frequent keywords
    const keywordsCount = {};
    querySnapshot.forEach(doc => {
      const paper = doc.data();
      if (paper.keywords) {
        paper.keywords.forEach(keyword => {
          if (keywordsCount[keyword]) {
            keywordsCount[keyword] += 1;
          } else {
            keywordsCount[keyword] = 1;
          }
        });
      }
    });
    // Sort keywords by count and select the top 10
    let top5Keywords = Object.entries(keywordsCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .reduce((obj, [key, value]) => {
        obj[key] = value;
        return obj;
      }, {});

    // find top 5 most frequent authors
    const authorsCount = {};
    querySnapshot.forEach(doc => {
      const paper = doc.data();
      if (paper.authors) {
        paper.authors.forEach(author => {
          if (authorsCount[author]) {
            authorsCount[author] += 1;
          } else {
            authorsCount[author] = 1;
          }
        });
      }
    });
    // Sort authors by count and select the top 5
    let top5Authors = Object.entries(authorsCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .reduce((obj, [key, value]) => {
        obj[key] = value;
        return obj;
      }, {});

    // find the top 5 most frequent content types
    const contentTypeCount = {};
    querySnapshot.forEach(doc => {
      const paper = doc.data();
      if (paper.contentType) {
        if (contentTypeCount[paper.contentType]) {
          contentTypeCount[paper.contentType] += 1;
        } else {
          contentTypeCount[paper.contentType] = 1;
        }
      }
    });
    let top5ContentType = Object.entries(contentTypeCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .reduce((obj, [key, value]) => {
        obj[key] = value;
        return obj;
      }, {});

    let sidebarData = { "keywords": top5Keywords, "authors": top5Authors, "contentType": top5ContentType, "date": {} };

    // find the number of papers for each year
    querySnapshot.forEach(doc => {
      const paper = doc.data();
      if (paper.year) {
        if (sidebarData.date[paper.year]) {
          sidebarData.date[paper.year] += 1;
        } else {
          sidebarData.date[paper.year] = 1;
        }
      }
    });

    updateSidebar(sidebarData);

    // use fetch to load the sidebar.json file ascynchronously
    // fetch('sidebar.json')
    //   .then(response => response.json()) // parse the JSON from the server
    //   .then(data => {
    //     // update the sidebar with the data from the server
    //     updateSidebar(data);
    //   })
    //   .catch(error => console.error('Error loading sidebar data:', error));

    // handle the sort dropdown
    var dropdownItems = document.querySelectorAll('#sort-dropdown-menu .dropdown-item');
    // Select the button with the ID 'sort-dropdown-toggle'
    var dropdownButton = document.querySelector('#sort-dropdown-toggle');

    dropdownItems.forEach(function (item) {
      item.addEventListener('click', function () {
        // Update the button text to match the clicked item's text
        dropdownButton.textContent = this.textContent;
        // Optional: Close the dropdown menu if it's open. This step might need adjustments based on your implementation.
      });
    });

    var dropdownButton = document.querySelector('#sort-dropdown-toggle');

    dropdownItems.forEach(function (item) {
      item.addEventListener('click', function () {
        // Update the button text to match the clicked item's text
        dropdownButton.textContent = this.textContent;
        // Optional: Close the dropdown menu if it's open. This step might need adjustments based on your implementation.
      });
    });
  }

  fetchData();
});


document.querySelectorAll('#sort-dropdown-menu .dropdown-item').forEach(item => {
  item.addEventListener('click', function () {
    // Get sort option from the clicked item
    sortOption = this.textContent;

    // Clear existing papers
    if (currentPage == "gallery") {
      document.getElementById('papersContainer').innerHTML = '';
    }
    else if (currentPage == "collections") {
      document.getElementById('collectionsContainer').innerHTML = '';
    }

    // Reset variables
    lastVisible = null;
    isLoading = false;
    allDataLoaded = false;

    // Update the sort button text
    document.getElementById('sort-dropdown-toggle').textContent = sortOption;

    // Reload papers based on the selected sort option
    loadPapers(sortOption, filterOption, curretnFilter).catch(console.error);
  });
});

// load collections papers
async function loadCollectionsPapers() {
  let paperQuery = query(collection(db, 'paper'), where("docId", "in", collectionList));
  const querySnapshot = await getDocs(paperQuery);
  querySnapshot.forEach((doc) => {
    const paper = doc.data();
    console.log(paper);
  });


  // append the cards to the page, use bs5 grid system
  let row; // track the current row of cards
  let counter = 0; // track the number of cards in the current row
  let collapseContentHTML = ""; // track the collapse content
  let index = 0;

  const imgPromises = [];
  const papersData = [];

  querySnapshot.forEach((doc) => {
    const paper = doc.data();
    const imgFileName = paper.doi.split('/').pop() + ".png";
    const imgRef = ref(storage, `${imgFileName}`);

    // Store paper data and prepare image URL fetch promise
    papersData.push({ paper, cardId: `card-${doc.id}`, collapseId: `collapse-${doc.id}` });
    imgPromises.push(getDownloadURL(imgRef).catch(() => null)); // Catch to ensure Promise.all resolves
  });

  const imgUrls = await Promise.all(imgPromises);

  // Now, with all URLs resolved, load cards in order
  querySnapshot.forEach((doc) => {
    const paper = doc.data();
    const cardId = `card-${doc.id}`;
    const collapseId = `collapse-${doc.id}`;
    loadCards(paper, cardId, collapseId, imgUrls[index]);
    index++;
  });

  isLoading = false; // after loading, set the loading flag to false

  function loadCards(paper, cardId, collapseId, url) {
    let cardHTML;
    // convert the keywords to HTML
    const keywordsHTML = paper.keywords.map(keyword =>
      `<span class="cardTag">${keyword}</span>`
    ).join('');
    let paperDocId = cardId.split('-')[1]; // get the paper document id (in the firebase database)

    // if the paper has an image, use the card with image
    if (url) {
      cardHTML = `
          <div class="col-md-4">
            <div class="card" id="${cardId}" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="false" aria-controls="${collapseId}">
              <img src="${url}" class="card-img-top" alt="...">
              <div class="card-body">
                <h5 class="card-title">${paper.title}</h5>  
                <p class="card-text">${paper.abstract}</p>
                <div class="card-metadata">
                  <p class="card-text">${paper.year}</p>
                  <p class="card-text">cited by: ${paper.citation_num}</p>
                  <p class="card-text">download: ${paper.download_num}</p>
                </div>
                <i class="lni lni-star-fill"></i>
                <div class="keywords-container">${keywordsHTML}</div>
              </div>
            </div>
          </div>
        `;
    } else {
      cardHTML = `
        <div class="col-md-4">
          <div class="card" id="${cardId}" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="false" aria-controls="${collapseId}">
            <div class="card-body">
              <h5 class="card-title">${paper.title}</h5>
              <p class="card-text">${paper.abstract}</p>

              <div class="card-metadata">
                <p class="card-text">${paper.year}</p>
                <p class="card-text">cited by: ${paper.citation_num}</p>
                <p class="card-text">download: ${paper.download_num}</p>
              </div>

              <i class="lni lni-star-fill"></i>

              <div class="keywords-container">${keywordsHTML}</div>
            </div>
          </div>
        </div>
      `;
    }
    // add collapse content
    collapseContentHTML += `
    <div id="${collapseId}" class="collapse" aria-labelledby="${cardId}" data-bs-parent="#${collapseId}-container">
        <div class="card card-body">
          <p><strong>Authors</strong>: ${paper.authors}</p>
          <p><strong>Link</strong>: <a href="${paper.doi}" target="_blank">${paper.doi}</a></p>
          <p><strong>Conference</strong>: ${paper.conference} | ${paper.contentType}</p>
          <p><strong>Abstract</strong>: ${paper.abstract_full}</p>
        </div>
    </div>
    `;

    if (counter == 0) {
      row = document.createElement('div');
      row.className = 'row';
      collectionsContainer.appendChild(row);
    }
    else if (counter % 3 === 0 && index != 0) { // every 3 cards, create a new row


      row = document.createElement('div');
      row.className = 'row';
      collectionsContainer.appendChild(row);
    }

    // add collapse content
    if (counter != 0 && counter % 3 === 2 || index === querySnapshot.docs.length - 1) {
      const collapseContainer = document.createElement('div');
      collapseContainer.id = `${collapseId}-container`;
      collectionsContainer.appendChild(collapseContainer);

      collapseContainer.innerHTML = collapseContentHTML;
      collapseContentHTML = ""; // clear the collapseContentHTML
    }

    row.innerHTML += cardHTML; // add the card to the row
    counter++; // increment the counter
  }

  // add click event to the collection icon, since new cards are loaded
  addClickToCollectionIcon();
}

// read the papers from the database and load them as cards
async function loadPapers(sortOption, filterOption, curretnFilter) {
  if (isLoading || allDataLoaded) return; // avoid loading at the same time
  isLoading = true;
  // console  .log('Loading more papers...');

  // get papers from collection
  let paperQuery;
  if (sortOption == "latest") {
    if (lastVisible)  // if not the first 18 load
    {
      if (!curretnFilter) {
        paperQuery = query(collection(db, 'paper'), orderBy("year", "desc"), startAfter(lastVisible), limit(18));
      }
      else if (curretnFilter == "year") {
        paperQuery = query(collection(db, 'paper'), orderBy("year", "desc"), where("year", ">=", Number(filterOption.year[0])), where("year", "<=", Number(filterOption.year[1])), startAfter(lastVisible), limit(18));
      }
      else if (curretnFilter == "keywords") {
        paperQuery = query(collection(db, 'paper'), orderBy("year", "desc"), where("keywords", "array-contains-any", filterOption.keywords), startAfter(lastVisible), limit(18));
      }
      else if (curretnFilter == "authors") {
        paperQuery = query(collection(db, 'paper'), orderBy("year", "desc"), where("authors", "array-contains-any", filterOption.authors), startAfter(lastVisible), limit(18));
      }
      else if (curretnFilter == "contentType") {
        paperQuery = query(collection(db, 'paper'), orderBy("year", "desc"), where("contentType", "in", filterOption.contentType), startAfter(lastVisible), limit(18));
      }
    }
    else  // if the first 18 load
    {
      if (!curretnFilter) {
        paperQuery = query(collection(db, 'paper'), orderBy("year", "desc"), limit(18));
      }
      else if (curretnFilter == "year") {
        paperQuery = query(collection(db, 'paper'), orderBy("year", "desc"), where("year", ">=", Number(filterOption.year[0])), where("year", "<=", Number(filterOption.year[1])), limit(18));
      }
      else if (curretnFilter == "keywords") {
        paperQuery = query(collection(db, 'paper'), orderBy("year", "desc"), where("keywords", "array-contains-any", filterOption.keywords), limit(18));
      }
      else if (curretnFilter == "authors") {
        paperQuery = query(collection(db, 'paper'), orderBy("year", "desc"), where("authors", "array-contains-any", filterOption.authors), limit(18));
      }
      else if (curretnFilter == "contentType") {
        paperQuery = query(collection(db, 'paper'), orderBy("year", "desc"), where("contentType", "in", filterOption.contentType), limit(18));
      }
    }
  }
  else if (sortOption == "earliest") {
    if (lastVisible) // if not the first 18 load
    {
      if (!curretnFilter) {
        paperQuery = query(collection(db, 'paper'), orderBy("year", "asc"), startAfter(lastVisible), limit(18));
      }
      else if (curretnFilter == "year") {
        paperQuery = query(collection(db, 'paper'), orderBy("year", "asc"), where("year", ">=", Number(filterOption.year[0])), where("year", "<=", Number(filterOption.year[1])), startAfter(lastVisible), limit(18));
      }
      else if (curretnFilter == "keywords") {
        paperQuery = query(collection(db, 'paper'), orderBy("year", "asc"), where("keywords", "array-contains-any", filterOption.keywords), startAfter(lastVisible), limit(18));
      }
      else if (curretnFilter == "authors") {
        paperQuery = query(collection(db, 'paper'), orderBy("year", "asc"), where("authors", "array-contains-any", filterOption.authors), startAfter(lastVisible), limit(18));
      }
      else if (curretnFilter == "contentType") {
        paperQuery = query(collection(db, 'paper'), orderBy("year", "asc"), where("contentType", "in", filterOption.contentType), startAfter(lastVisible), limit(18));
      }
    }
    else // if the first 18 load
    {
      if (!curretnFilter) {
        paperQuery = query(collection(db, 'paper'), orderBy("year", "asc"), where("year", ">=", 2023), where("year", "<=", 2024), limit(18));
      }
      else if (curretnFilter == "year") {
        paperQuery = query(collection(db, 'paper'), orderBy("year", "asc"), where("year", ">=", Number(filterOption.year[0])), where("year", "<=", Number(filterOption.year[1])), limit(18));
      }
      else if (curretnFilter == "keywords") {
        paperQuery = query(collection(db, 'paper'), orderBy("year", "asc"), where("keywords", "array-contains-any", filterOption.keywords), limit(18));
      }
      else if (curretnFilter == "authors") {
        paperQuery = query(collection(db, 'paper'), orderBy("year", "asc"), where("authors", "array-contains-any", filterOption.authors), limit(18));
      }
      else if (curretnFilter == "contentType") {
        paperQuery = query(collection(db, 'paper'), orderBy("year", "asc"), where("contentType", "in", filterOption.contentType), limit(18));
      }
    }
  }
  else if (sortOption == "citation") {
    if (lastVisible) // if not the first 18 load
    {
      if (!curretnFilter) {
        paperQuery = query(collection(db, 'paper'), orderBy("citation_num", "desc"), startAfter(lastVisible), limit(18));
      }
      else if (curretnFilter == "keywords") {
        paperQuery = query(collection(db, 'paper'), orderBy("citation_num", "desc"), where("keywords", "array-contains-any", filterOption.keywords), startAfter(lastVisible), limit(18));
      }
      else if (curretnFilter == "authors") (
        paperQuery = query(collection(db, 'paper'), orderBy("citation_num", "desc"), where("authors", "array-contains-any", filterOption.authors), startAfter(lastVisible), limit(18))
      )
      else if (curretnFilter == "contentType") {
        paperQuery = query(collection(db, 'paper'), orderBy("citation_num", "desc"), where("contentType", "in", filterOption.contentType), startAfter(lastVisible), limit(18));
      }
    }
    else // if the first 18 load
    {
      if (!curretnFilter) {
        paperQuery = query(collection(db, 'paper'), orderBy("citation_num", "desc"), limit(18));
      }
      else if (curretnFilter == "keywords") {
        paperQuery = query(collection(db, 'paper'), orderBy("citation_num", "desc"), where("keywords", "array-contains-any", filterOption.keywords), limit(18));
      }
      else if (curretnFilter == "authors") {
        paperQuery = query(collection(db, 'paper'), orderBy("citation_num", "desc"), where("authors", "array-contains-any", filterOption.authors), limit(18));
      }
      else if (curretnFilter == "contentType") {
        paperQuery = query(collection(db, 'paper'), orderBy("citation_num", "desc"), where("contentType", "in", filterOption.contentType), limit(18));
      }
    }
  }
  else if (sortOption == "downloaded") {
    if (lastVisible) // if not the first 18 load
    {
      if (!curretnFilter) {
        paperQuery = query(collection(db, 'paper'), orderBy("download_num", "desc"), startAfter(lastVisible), limit(18));
      }
      else if (curretnFilter == "keywords") {
        paperQuery = query(collection(db, 'paper'), orderBy("download_num", "desc"), where("keywords", "array-contains-any", filterOption.keywords), startAfter(lastVisible), limit(18));
      }
      else if (curretnFilter == "authors") (
        paperQuery = query(collection(db, 'paper'), orderBy("download_num", "desc"), where("authors", "array-contains-any", filterOption.authors), startAfter(lastVisible), limit(18))
      )
      else if (curretnFilter == "contentType") {
        paperQuery = query(collection(db, 'paper'), orderBy("download_num", "desc"), where("contentType", "in", filterOption.contentType), startAfter(lastVisible), limit(18));
      }
    }
    else // if the first 18 load
    {
      if (!curretnFilter) {
        paperQuery = query(collection(db, 'paper'), orderBy("download_num", "desc"), limit(18));
      }
      else if (curretnFilter == "keywords") {
        paperQuery = query(collection(db, 'paper'), orderBy("download_num", "desc"), where("keywords", "array-contains-any", filterOption.keywords), limit(18));
      }
      else if (curretnFilter == "authors") {
        paperQuery = query(collection(db, 'paper'), orderBy("download_num", "desc"), where("authors", "array-contains-any", filterOption.authors), limit(18));
      }
      else if (curretnFilter == "contentType") {
        paperQuery = query(collection(db, 'paper'), orderBy("download_num", "desc"), where("contentType", "in", filterOption.contentType), limit(18));
      }
    }
  }

  const querySnapshot = await getDocs(paperQuery);

  if (querySnapshot.docs.length < 18) {
    allDataLoaded = true; // if the number of documents is less than 18, all data is loaded
  }

  if (!querySnapshot.empty) {
    lastVisible = querySnapshot.docs[querySnapshot.docs.length - 1];
  }

  // append the cards to the page, use bs5 grid system
  let row; // track the current row of cards
  let counter = 0; // track the number of cards in the current row
  let collapseContentHTML = ""; // track the collapse content
  let index = 0;

  const imgPromises = [];
  const papersData = [];

  querySnapshot.forEach((doc) => {
    const paper = doc.data();
    const imgFileName = paper.doi.split('/').pop() + ".png";
    const imgRef = ref(storage, `${imgFileName}`);

    // Store paper data and prepare image URL fetch promise
    papersData.push({ paper, cardId: `card-${doc.id}`, collapseId: `collapse-${doc.id}` });
    imgPromises.push(getDownloadURL(imgRef).catch(() => null)); // Catch to ensure Promise.all resolves
  });

  const imgUrls = await Promise.all(imgPromises);

  // Now, with all URLs resolved, load cards in order
  querySnapshot.forEach((doc) => {
    const paper = doc.data();
    const cardId = `card-${doc.id}`;
    const collapseId = `collapse-${doc.id}`;
    loadCards(paper, cardId, collapseId, imgUrls[index]);
    index++;
  });

  isLoading = false; // after loading, set the loading flag to false

  function loadCards(paper, cardId, collapseId, url) {
    let cardHTML;
    // convert the keywords to HTML
    const keywordsHTML = paper.keywords.map(keyword =>
      `<span class="cardTag">${keyword}</span>`
    ).join('');
    let paperDocId = cardId.split('-')[1]; // get the paper document id (in the firebase database)

    // if the paper has an image, use the card with image
    if (url) {
      if (loginStatus) {
        if (collectionList.includes(paperDocId)) // if the paper is in the collection, add the filled star icon
        {
          cardHTML = `
          <div class="col-md-4">
            <div class="card" id="${cardId}" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="false" aria-controls="${collapseId}">
              <img src="${url}" class="card-img-top" alt="...">
              <div class="card-body">
                <h5 class="card-title">${paper.title}</h5>  
                <p class="card-text">${paper.abstract}</p>
                <div class="card-metadata">
                  <p class="card-text">${paper.year}</p>
                  <p class="card-text">cited by: ${paper.citation_num}</p>
                  <p class="card-text">download: ${paper.download_num}</p>
                </div>
                <i class="lni lni-star-fill"></i>
                <div class="keywords-container">${keywordsHTML}</div>
              </div>
            </div>
          </div>
        `;
        }
        else // if the paper is not in the collection, add the empty star icon
        {
          cardHTML = `
          <div class="col-md-4">
            <div class="card" id="${cardId}" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="false" aria-controls="${collapseId}">
              <img src="${url}" class="card-img-top" alt="...">
              <div class="card-body">
                <h5 class="card-title">${paper.title}</h5>  
                <p class="card-text">${paper.abstract}</p>
                <div class="card-metadata">
                  <p class="card-text">${paper.year}</p>
                  <p class="card-text">cited by: ${paper.citation_num}</p>
                  <p class="card-text">download: ${paper.download_num}</p>
                </div>
                <i class="lni lni-star-empty"></i>
                <div class="keywords-container">${keywordsHTML}</div>
              </div>
            </div>
          </div>
        `;
        }

      }
      else {
        cardHTML = `
        <div class="col-md-4">
          <div class="card" id="${cardId}" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="false" aria-controls="${collapseId}">
            <img src="${url}" class="card-img-top" alt="...">
            <div class="card-body">
              <h5 class="card-title">${paper.title}</h5>  
              <p class="card-text">${paper.abstract}</p>
              <div class="card-metadata">
                <p class="card-text">${paper.year}</p>
                <p class="card-text">cited by: ${paper.citation_num}</p>
                <p class="card-text">download: ${paper.download_num}</p>
              </div>

              <div class="keywords-container">${keywordsHTML}</div>
            </div>
          </div>
        </div>
      `;
      }


    } else {
      if (loginStatus) {
        cardHTML = `
        <div class="col-md-4">
          <div class="card" id="${cardId}" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="false" aria-controls="${collapseId}">
            <div class="card-body">
              <h5 class="card-title">${paper.title}</h5>
              <p class="card-text">${paper.abstract}</p>

              <div class="card-metadata">
                <p class="card-text">${paper.year}</p>
                <p class="card-text">cited by: ${paper.citation_num}</p>
                <p class="card-text">download: ${paper.download_num}</p>
              </div>

              <i class="lni lni-star-empty"></i>

              <div class="keywords-container">${keywordsHTML}</div>
            </div>
          </div>
        </div>
      `;
      }
      else {
        cardHTML = `
        <div class="col-md-4">
          <div class="card" id="${cardId}" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="false" aria-controls="${collapseId}">
            <div class="card-body">
              <h5 class="card-title">${paper.title}</h5>
              <p class="card-text">${paper.abstract}</p>

              <div class="card-metadata">
                <p class="card-text">${paper.year}</p>
                <p class="card-text">cited by: ${paper.citation_num}</p>
                <p class="card-text">download: ${paper.download_num}</p>
              </div>

              <div class="keywords-container">${keywordsHTML}</div>
            </div>
          </div>
        </div>
      `;
      }

    }
    // add collapse content
    collapseContentHTML += `
    <div id="${collapseId}" class="collapse" aria-labelledby="${cardId}" data-bs-parent="#${collapseId}-container">
        <div class="card card-body">
          <p><strong>Authors</strong>: ${paper.authors}</p>
          <p><strong>Link</strong>: <a href="${paper.doi}" target="_blank">${paper.doi}</a></p>
          <p><strong>Conference</strong>: ${paper.conference} | ${paper.contentType}</p>
          <p><strong>Abstract</strong>: ${paper.abstract_full}</p>
        </div>
    </div>
`;

    if (counter == 0) {
      row = document.createElement('div');
      row.className = 'row';
      if (currentPage == "gallery") {
        papersContainer.appendChild(row);
      }
      else if (currentPage == "collections") {
        collectionsContainer.appendChild(row);
      }
    }
    else if (counter % 3 === 0 && index != 0) { // every 3 cards, create a new row


      row = document.createElement('div');
      row.className = 'row';
      if (currentPage == "gallery") {
        papersContainer.appendChild(row);
      }
      else if (currentPage == "collections") {
        collectionsContainer.appendChild(row);
      }
    }

    // add collapse content
    if (counter != 0 && counter % 3 === 2 || index === querySnapshot.docs.length - 1) {
      const collapseContainer = document.createElement('div');
      collapseContainer.id = `${collapseId}-container`;
      if (currentPage == "gallery") {
        papersContainer.appendChild(collapseContainer);
      }
      else if (currentPage == "collections") {
        collectionsContainer.appendChild(collapseContainer);
      }
      collapseContainer.innerHTML = collapseContentHTML;
      collapseContentHTML = ""; // clear the collapseContentHTML
    }

    row.innerHTML += cardHTML; // add the card to the row
    counter++; // increment the counter
  }
  addClickToCollectionIcon(); // add click event to the collection icon (since there are new cards added)

}

// initial load; load the first 18 papers
loadPapers(sortOption, filterOption, curretnFilter).catch(console.error);

function showSpinner() {
  document.getElementById('spinnerContainer').style.display = 'block';
}

function hideSpinner() {
  document.getElementById('spinnerContainer').style.display = 'none';
}

function checkScrollBottom() {
  const isActive = document.querySelector('.nav.nav-underline .nav-item a[href="#gallery"]').classList.contains('active');

  // check if the user has scrolled to the bottom of the page
  if (isActive && Math.abs(window.innerHeight + window.scrollY - document.body.offsetHeight) < 1 && !isLoading && !allDataLoaded) {
    showSpinner(); // show spinner when loading
    setTimeout(() => {
      console.log('call loadPapers()...');
      loadPapers(sortOption, filterOption, curretnFilter).then(() => {
        hideSpinner(); // after loading, hide the spinner
      });
    }, 1000); // delay 1 second to show the spinner
  }
}

// add event listener to the window object
window.addEventListener('scroll', checkScrollBottom);


// after login, the user can add collections: load the 🌟 icons for the collecting
function addCollectionIcon() {
  document.querySelectorAll('.col-md-4 .card').forEach(card => {
    const icon = document.createElement('i');
    icon.className = 'lni lni-star-empty';
    card.appendChild(icon);
  });
}

// after loading some paper, then the user login, the paper cards icon should be updated
function changeToFillStar() {
  console.log("list" + collectionList);

}

// add click event to the collection icon
function addClickToCollectionIcon() {
  document.querySelectorAll('.card .lni-star-empty, .card .lni-star-fill').forEach(icon => {
    icon.addEventListener('click', function () {
      // read icon class name
      if (this.className == 'lni lni-star-fill') {
        this.className = 'lni lni-star-empty';
        const cardId = this.closest('.card').id.split('-')[1];
        const userDocRef = doc(db, 'users', userID);
        getDoc(userDocRef).then(docSnap => {
          if (docSnap.exists()) {
            // If the document exists, update or set the collection field
            let collections = docSnap.data().collections || [];
            if (collections.includes(cardId)) {
              collections = collections.filter(id => id !== cardId);
              updateDoc(userDocRef, { collections: collections });
            }
            collectionList = collections;
          }
        }).catch(error => console.error("Error updating user document:", error));

      }
      else {
        // Change the icon to filled star
        this.className = 'lni lni-star-fill';

        // Get the ID of the card by accessing the parent .card div's id
        const cardId = this.closest('.card').id.split('-')[1];
        console.log(cardId); // For testing

        const userDocRef = doc(db, 'users', userID);

        // Update the user's document with the card ID
        getDoc(userDocRef).then(docSnap => {
          if (docSnap.exists()) {
            // If the document exists, update or set the collection field
            let collections = docSnap.data().collections || [];
            if (!collections.includes(cardId)) {
              collections.push(cardId);
              updateDoc(userDocRef, { collections: collections });
            }
            collectionList = collections;
          }
        }).catch(error => console.error("Error updating user document:", error));
      }
    });
  });
}

// called once, when the user just login. get the user's collections from the database, and update the collection icon
function updateCollection() {
  const userDocRef = doc(db, 'users', userID);
  getDoc(userDocRef).then(docSnap => {
    if (docSnap.exists()) {
      // If the document exists, update or set the collection field
      collectionList = docSnap.data().collections || [];
      console.log(collectionList);
      document.querySelectorAll('.card').forEach(card => {
        const cardId = card.id.split('-')[1];
        // console.log(cardId);

        if (collectionList.includes(cardId)) {
          // console.log(cardId);
          card.querySelector('.lni-star-empty').className = 'lni lni-star-fill';
        }
      });
    }
  }).catch(error => console.error("Error updating user document:", error));

  // the initial load of the user's collections papers
  loadCollectionsPapers(); // load the user's collections papers
}

// handle the google sign in
document.getElementById('googleSignInButton').addEventListener('click', () => {
  const provider = new GoogleAuthProvider();
  const auth = getAuth();
  signInWithPopup(auth, provider)
    .then(async (result) => {
      if (result.user) { // User is signed in
        const user = result.user;
        const usersRef = doc(db, 'users', user.uid);
        const docSnap = await getDoc(usersRef);

        if (!docSnap.exists()) {
          // New user: Add to Firestore
          await setDoc(usersRef, { username: user.displayName });
        }

        // Replace the login button with "Hi, [Username]"
        const loginButton = document.getElementById('googleSignInButton');
        loginButton.outerHTML = `<span><i class="lni lni-friendly"></i>Hi, ${user.displayName}</span>`;
        console.log(user.displayName);
        console.log(user.uid);
        userID = user.uid;
        loginStatus = true;
        addCollectionIcon(); // load the 🌟 icons for the collecting
        addClickToCollectionIcon(); // add click event to the collection icon
        updateCollection(); // update the user's collections from the database
        document.querySelector('a[href="#collections"]').style.display = 'block'; //show the collections tab

      }
    })
    .catch((error) => {
      // Handle Errors here.
      console.error(error);
    });
});


// AI RAG application setup

// capture the user input
document.addEventListener('DOMContentLoaded', function () {
  const chatInput = document.getElementById('chatInput');
  const uploadButton = document.getElementById('uploadButton');

  // Function to handle input submission
  function handleInputSubmission() {
    const userQuestion = chatInput.value;
    console.log(userQuestion);

    // Insert spinner above chatInput
    const spinner = document.createElement('div');
    spinner.className = 'spinner-grow';
    spinner.setAttribute('role', 'status');
    spinner.innerHTML = '<span class="visually-hidden">Loading...</span>';
    document.querySelector('.chat-input-container').insertBefore(spinner, chatInput);

    // firebase cloud function URL
    const url = new URL("https://texverse-ai-qa-lebwgsie4q-uc.a.run.app");
    const params = { text: userQuestion };
    url.search = new URLSearchParams(params).toString();

    // use fetch to send the user question to the server
    fetch(url)
      .then(response => response.text()) // convert the response to text
      .then(text => {
        console.log(text);

        const chatOutput = document.getElementById('chatOutput');

        // Create user question bubble
        let userBubble = document.createElement('div');
        userBubble.className = 'chat-bubble user';
        userBubble.innerHTML = `<i class="lni lni-friendly"></i><div class="chat-bubble-text"><strong>You</strong><p>${userQuestion}</p></div>`;
        chatOutput.appendChild(userBubble);

        // // Convert AI response from Markdown to HTML
        // let converter = new showdown.Converter();
        // let aiResponseHtml = converter.makeHtml(text);

        // Create AI response bubble
        let aiBubble = document.createElement('div');
        const renderedHtml = converter.makeHtml(text);
        aiBubble.className = 'chat-bubble ai';
        aiBubble.innerHTML = `<i class="lni lni-twitch"></i><div class="chat-bubble-text"><strong>TexVerse ChatBot</strong><p>${renderedHtml}</p></div>`;
        chatOutput.appendChild(aiBubble);

        // Scroll to the bottom of chatOutput
        chatOutput.scrollTop = chatOutput.scrollHeight;

        // Remove spinner once the response is processed
        spinner.remove();

      })
      .catch(error => {
        console.error('Error:', error);
        // Remove spinner once the response is processed
        spinner.remove();
      });

    // Reset the input field
    chatInput.value = '';
  }

  // Capture Enter key in the input box
  chatInput.addEventListener('keydown', function (event) {
    if (event.key === "Enter") {
      event.preventDefault(); // Prevent default action of Enter key
      handleInputSubmission();
    }
  });

  // Capture click on the upload button
  uploadButton.addEventListener('click', handleInputSubmission);
  // handleInputSubmission();
});
