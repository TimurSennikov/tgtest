const server = "http://127.0.0.1:1234";

setInterval(async () => {
    console.log(await fetch(`${server}/players`));
}, 1000);