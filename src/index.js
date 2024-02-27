// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore, collection, getDoc, getDocs, setDoc, doc, query, startAfter, limit } from "firebase/firestore";
import { getStorage, ref, getDownloadURL } from "firebase/storage";
import { getAuth, signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import * as d3 from "d3";
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';

var yearList; // global variable to store the year list
// load sidebar data
document.addEventListener('DOMContentLoaded', function () {
  // use fetch to load the sidebar.json file ascynchronously
  fetch('sidebar.json')
    .then(response => response.json()) // parse the JSON from the server
    .then(data => {
      // update the sidebar with the data from the server
      updateSidebar(data);
    })
    .catch(error => console.error('Error loading sidebar data:', error));

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
});

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
  let sidebarList = ["keywords", "authors", "institutions", "publication", "contentType"];
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

  // color for the tags
  const colors = {
    "authors": "#9961e1",
    "keywords": "#93c6ff",
    "institutions": "#4494c4",
    "publication": "#89e5c3",
    "contentType": "#56baf6"
  };

  // Add tag, remove tag and toggle tag selection logic
  document.querySelectorAll('.sidebar-tag').forEach(item => {
    item.addEventListener('click', function (e) {
      e.preventDefault();

      this.classList.toggle('sidebar-tag-selected');
      this.classList.toggle('sidebar-link');

      const tagName = this.textContent.match(/^(.+?)\s\(\d+\)$/)[1];

      if (this.classList.contains('sidebar-tag-selected')) {
        const category = this.parentNode.parentNode.id;
        const color = colors[category] || '#000000'; // Default color if category not found

        const tag = document.createElement('span');
        tag.textContent = tagName;
        tag.style.backgroundColor = color;
        tag.className = `dynamic-tag dynamic-tag-name-${tagName.replace(/\s+/g, "-")}`;

        const removeBtn = document.createElement('span');
        removeBtn.textContent = ' x';
        removeBtn.style.cursor = 'pointer';
        removeBtn.onclick = function () {
          this.parentNode.remove();
          const sidebarTag = document.querySelector(`.tag-name-${tagName.replace(/\s+/g, "-")}`);
          if (sidebarTag) {
            sidebarTag.classList.toggle('sidebar-tag-selected');
            sidebarTag.classList.toggle('sidebar-link');
          }
        };
        tag.appendChild(removeBtn);

        document.getElementById('tags-container').appendChild(tag);
      } else {
        // Remove tag logic
        const existingTag = document.querySelector(`#tags-container .dynamic-tag-name-${tagName.replace(/\s+/g, "-")}`);
        if (existingTag) {
          existingTag.remove();
        }
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

let lastVisible = null; // global variable to store the last visible document
let isLoading = false; // track if it's loading
let allDataLoaded = false; // track if all data is loaded

// read the papers from the database and load them as cards
async function loadPapers() {
  if (isLoading || allDataLoaded) return; // avoid loading at the same time
  isLoading = true;
  // console.log('Loading more papers...');

  // get papers from collection
  let paperQuery;
  if (lastVisible) {
    paperQuery = query(collection(db, 'paper'), startAfter(lastVisible), limit(18));
  } else {
    paperQuery = query(collection(db, 'paper'), limit(18));
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
  let collapseContentHTML = ""; // 用于累积当前row的所有collapse内容
  let index = 0;

  querySnapshot.forEach((doc) => {
    const paper = doc.data();
    const cardId = `card-${doc.id}`;
    const collapseId = `collapse-${doc.id}`;

    const imgFileName = paper.doi.split('/').pop() + ".png";
    const imgRef = ref(storage, `${imgFileName}`);

    getDownloadURL(imgRef).then((url) => {
      loadCards(paper, cardId, collapseId, url);
    }).catch((error) => {
      loadCards(paper, cardId, collapseId, null);
    });
    index++;
  });

  isLoading = false; // after loading, set the loading flag to false

  function loadCards(paper, cardId, collapseId, url) {
    let cardHTML;
    // 转换关键词列表为HTML标签字符串
    const keywordsHTML = paper.keywords.map(keyword =>
      `<span class="cardTag">${keyword}</span>`
    ).join('');

    // if the paper has an image, use the card with image
    if (url) {
      cardHTML = `
        <div class="col-md-4">
          <div class="card" id="${cardId}" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="false" aria-controls="${collapseId}">
            <img src="${url}" class="card-img-top" alt="...">
            <div class="card-body">
              <h5 class="card-title">${paper.title}</h5>
              <p class="card-text">${paper.abstract}</p>
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
              <div class="keywords-container">${keywordsHTML}</div>
            </div>
          </div>
        </div>
      `;
    }
    // 累积collapseHTML内容
    collapseContentHTML += `
    <div id="${collapseId}" class="collapse" aria-labelledby="${cardId}" data-bs-parent="#${collapseId}-container">
        <div class="card card-body">
            <p>Title: ${paper.title}</p>
            <p>Full Abstract: ${paper.abstract_full}</p>
            <p>Cited Number: ${paper.citation_num}</p>
            <p>Download Number: ${paper.download_num}</p>
        </div>
    </div>
`;

    if (counter == 0) {
      row = document.createElement('div');
      row.className = 'row';
      papersContainer.appendChild(row);
    }
    else if (counter % 3 === 0 && index != 0) { // 每三个卡片开始新的一行，除了第一行


      row = document.createElement('div');
      row.className = 'row';
      papersContainer.appendChild(row);
    }

    // add collapse content
    if (counter != 0 && counter % 3 === 2 || index === querySnapshot.docs.length - 1) {
      const collapseContainer = document.createElement('div');
      collapseContainer.id = `${collapseId}-container`;
      papersContainer.appendChild(collapseContainer);
      collapseContainer.innerHTML = collapseContentHTML;
      collapseContentHTML = ""; // clear the collapseContentHTML
    }



    row.innerHTML += cardHTML; // 将卡片添加到当前行
    counter++; // 更新卡片计数器
  }

}


// initial load; load the first 18 papers
loadPapers().catch(console.error);

function showSpinner() {
  document.getElementById('spinnerContainer').style.display = 'block';
}

function hideSpinner() {
  document.getElementById('spinnerContainer').style.display = 'none';
}

function checkScrollBottom() {
  // check if the user has scrolled to the bottom of the page
  if (Math.abs(window.innerHeight + window.scrollY - document.body.offsetHeight) < 1 && !isLoading && !allDataLoaded) {
    showSpinner(); // 显示加载中的spinner
    setTimeout(() => {
      console.log('call loadPapers()...');
      loadPapers().then(() => {
        hideSpinner(); // 加载完成后隐藏spinner
      });
    }, 1000); // 延迟1秒显示加载效果
  }
}

// 添加滚动事件监听器
window.addEventListener('scroll', checkScrollBottom);


// handle the google sign in
// login button
let openai;

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
        else {
          // get the openai api key
          const data = docSnap.data();
          // initialize OpenAI
          openai = new OpenAI({
            apiKey: data.apiKey,
            baseURL: data.baseURL,
            dangerouslyAllowBrowser: true
          });
          console.log(openai);
          async function main() {
            const chatCompletion = await openai.chat.completions.create({
              messages: [{ role: 'user', content: 'Say this is a test' }],
              model: 'gpt-3.5-turbo',
            });
            console.log(chatCompletion);
          }

          main();
        }

        // Replace the login button with "Hi, [Username]"
        const loginButton = document.getElementById('googleSignInButton');
        loginButton.outerHTML = `<span><i class="lni lni-friendly"></i>Hi, ${user.displayName}</span>`;
        console.log(user.displayName);
        console.log(user.uid);
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

    // 定义请求的 URL 和参数
    const url = new URL("https://texverse-ai-qa-lebwgsie4q-uc.a.run.app");
    const params = { text: userQuestion };
    url.search = new URLSearchParams(params).toString();

    // 使用 fetch 发送 GET 请求
    fetch(url)
      .then(response => response.text()) // 将响应转换为文本
      .then(text => console.log(text))   // 打印响应文本
      .catch(error => console.error('Error:', error)); // 处理可能的错误

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

});
