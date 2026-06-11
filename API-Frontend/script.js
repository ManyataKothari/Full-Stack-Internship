const container = document.getElementById("data-container");

fetch("https://jsonplaceholder.typicode.com/users")
  .then((res) => res.json())
  .then((users) => {
    users.forEach((user)=> {
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `
          <h3>${user.name}</h3>
          <p><strong>Email:</strong>${user.email}</p>
          <p><strong>City:</strong> ${user.address.city}</p>
          `;
          container.appendChild(card);
    });
  })
  .catch((err)=>{
    container.innerHTML = "<p>Error fatching data.</p>";
    console.error
  });