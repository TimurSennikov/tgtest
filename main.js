const {Telegraf} = require("telegraf");
const {message} = require("telegraf/filters");
const cors = require("cors");

const app = require("express")();

const db = require("better-sqlite3")("server.db");

//db.exec("CREATE TABLE scoreboard(id NUMBER, score NUMBER)");

const fs = require("fs");
const { json, text } = require("express");
const { keyboard } = require("telegraf/markup");

const bot = new Telegraf("TOKEN");

app.use(cors);

class Players{
    exists(id){
        if(!db.prepare("SELECT * FROM participants WHERE id = ?").get(id)){return false;}
        else{return true;}
    }

    add(id){
        if(!this.exists(id)){
            db.prepare("INSERT INTO participants VALUES(?, 0)").run(id);
            return true;
        }
        else{return false;}
    }

    del(id){
        if(this.exists(id)){
            db.prepare("DELETE FROM participants WHERE id = ?").run(id);
            return true;
        }
        else{return false;}
    }

    checkAnswered(id){
        if(!this.exists(id)){return false;}
        else{
            db.prepare("UPDATE participants SET answered = ? WHERE id = ?").run(1, id);
        }
    }

    all(){
        return db.prepare("SELECT * FROM participants").all();
    }
};

class Scoreboard{
    exists(id){
        if(!db.prepare("SELECT * FROM scoreboard WHERE id = ?").get(id)){return false;}
        else{return true;}
    }

    clear(){
        try{
            this.all().forEach((player) => {
                db.prepare("DELETE FROM scoreboard WHERE id = ?").run(player.id);
            });
        }
        catch(e){
            return false;
        }
        finally{
            return true;
        }
    }

    add(id){
        if(!this.exists(id)){db.prepare("INSERT INTO scoreboard VALUES(?, ?)").run(id, 0);}

        try{
            db.prepare("UPDATE scoreboard SET score = ? WHERE id = ?").run(db.prepare("SELECT * FROM scoreboard WHERE id = ?").get(id).score + 1, id);
        }
        catch(e){
            console.err(e);
            return false;
        }
        finally{
            return true;
        }
    }

    all(){
        return db.prepare("SELECT * FROM scoreboard").all();
    }
};

class Permissions{
    #users = null;

    #update(){
        try{
            this.#users = JSON.parse(fs.readFileSync("permissions.json"))["users"];
        }
        catch(error){
            console.error("Please create permissions.json file with admins, e.g. {'users': {'6463448650': 'admin'}}");
            process.exit(1);
        }
    }
    
    role(id){this.#update(); console.log(this.#users); if(!this.#users){return "user";}else{if(!this.#users[parseInt(id, 10)]){return "user";}else{return this.#users[parseInt(id, 10)];}}}
};

const players = new Players();
const scoreboard = new Scoreboard();
const permissions = new Permissions();

var quiz = {
    title: null,
    questions: null,
    question: 0,

    totalAnswered: 0,
    totalCorrect: 0,

    answered: 0,
    correct: 0,

    tick: () => {
        if(quiz.answered >= players.all().length / 2){
            let i = (prev) => {
                players.all.forEach((player) => {bot.telegram.sendMessage(player.id, "Замечен АФКшер, через 60 секунд переходим к следующему вопросу...");});
                setTimeout(() => {
                    if(quiz.questions[quiz.question]["q"] == prev){question++; sayQ();}
                }, 60000);
            }

            i(quiz.questions[quiz.question]["q"]);
        }
    },

    update: (file) => {
        if(file == undefined){file = "quiz.json";}

        try{
            let text = fs.readFileSync(file);
            text = JSON.parse(text);
            
            quiz.title = text["title"];
            quiz.questions = text["questions"];
            quiz.question = 0;

            scoreboard.clear();

            setTimeout(() => {quiz.sayQ();}, 500);
            return true;
        }
        catch(error){
            console.error(error);
            return false;
        }
    },

    sayQ: async (id) => {
        let markup = [];
        if(quiz.questions[quiz.question]["answers"]){
            quiz.questions[quiz.question]["answers"].forEach((possibility) => {
                markup.push([{text: possibility}]);
            });
        }

        if(!id){
            players.all().forEach((player) => {
                setTimeout(() => {bot.telegram.sendMessage(player.id, `Следующий вопрос: ${quiz.questions[quiz.question]["q"]}?`, {reply_markup: {
                        keyboard: (markup.length < 1 ? null : markup)
                    }
                });}, 500);
            });
        }
        else{
            setTimeout(() => {bot.telegram.sendMessage(id, `Следующий вопрос: ${quiz.questions[quiz.question]["q"]}?`, {reply_markup: {
                    keyboard: (markup.length < 1 ? null : markup)
                }
            });}, 500);
        }
    },

    answer: async (id, opinion) => {
        if(!quiz.questions){bot.telegram.sendMessage(id, "Похоже, квиз еще не начался..."); return;}

        players.checkAnswered(id);
        quiz.answered++;

        if(opinion == quiz.questions[quiz.question]["a"]){bot.telegram.sendMessage(id, `Правильно!`); scoreboard.add(id); quiz.correct++;}
        else{bot.telegram.sendMessage(id, `Неправильно!`);}

        if(quiz.answered >= players.all().length){
            players.all().forEach((player) => {
                bot.telegram.sendMessage(player.id, `Конец текущего вопроса, правильные ответы ${quiz.correct} из ${quiz.answered}.`);
            });

            quiz.totalAnswered += quiz.answered;
            quiz.totalCorrect += quiz.correct;

            quiz.answered = 0;
            quiz.correct = 0;

            quiz.question++;
            if(!quiz.questions[quiz.question]){
                players.all().forEach((player) => {
                    bot.telegram.sendMessage(player.id, `Конец опроса, правильные ответы ${quiz.totalCorrect} из ${quiz.totalAnswered}.`);
                    players.del(player.id);
                });

                quiz.reset();
            }
            else{
                quiz.sayQ();
            }
        }
        else{
            players.all().forEach((player) => {
                bot.telegram.sendMessage(player.id, `Ждем ответа еще ${players.all().length - quiz.answered} игрока/ов.`);
            });
        }
    },

    start: async() => {
        players.all().forEach((player) => {bot.telegram.sendMessage(player.id, "Тест начался!");});
    },

    reset: () => {
        quiz.title = null;
        quiz.questions = null;
        quiz.question = 0;
        quiz.answered = 0;
        quiz.correct = 0;
        quiz.totalAnswered = 0;
        quiz.totalCorrect = 0;
    }
};

bot.command("quiz", async (ctx) => {
    if(!quiz.title){ctx.reply("В память не загружен квиз, пока что тут пустовато...");}
    else{ctx.reply(`Сейчас квиз ${quiz.title} проходят ${players.all().length} человек/а`)}
});

bot.command("subscribe", async (ctx) => {
    ctx.reply((players.add(ctx.chat.id) && scoreboard.add(ctx.chat.id)) == true ? "Вы подключились к текущему тесту..." : "Вы уже числитесь участником теста!");
    if(quiz.questions){quiz.sayQ(ctx.chat.id);}
    console.log(ctx.from.username + " subscribed");
});

bot.command("unsubscribe", async (ctx) => {
    ctx.reply(players.del(ctx.chat.id) == true ? "Вы отключились от текущего теста..." : "Вы и так не числитесь участником теста!");
});

// админ функции
bot.command("load", async (ctx) => {
    if(permissions.role(ctx.from.id) != "admin"){ctx.reply("Игру могут начинать только админы!"); return;}

    let res = quiz.update(ctx.message.text.split("/load ")[1]);

    if(res){
        ctx.reply("Квиз успешно загружен!");
    }
    else{
        ctx.reply("Не удалось загрузить квиз.");
    }
});

bot.command("players", async (ctx) => {
    if(permissions.role(ctx.from.id) != "admin"){ctx.reply("Управлять игроками могут только админы!"); return;}
    if(players.all().length <= 0){await ctx.reply("Игроки не найдены...")}
    await players.all().forEach(async (player) => {
        ctx.reply(`${(await bot.telegram.getChat(player.id)).username} (${player.id}) ответил?: ${player.answered == 1 ? "да" : "нет"}`, {
            reply_markup: {
                inline_keyboard: [
                    [{text: "кикнуть", callback_data: `kick?${player.id}`}, {text: "заигнорить", callback_data: `ignore?${player.id}`}]
                ]
            }
        });
    });

    await ctx.reply("Скорборд будет снизу если в нем есть игроки!", {
        reply_markup: {
            inline_keyboard: [
                [{text: "Очистить (есть автоочистка)", callback_data: "clearScoreboard"}]
            ]
        }
    }).then(() => {
        scoreboard.all().forEach((player) => {
            ctx.reply("ID: " + player.id + " SCORE: " + player.score);
        });
    });
});
// -------------

// actions
bot.action(/^kick?.*/, (ctx) => {
    if(permissions.role(ctx.from.id) != "admin"){return;}

    let id = ctx.match[0].split("?")[1];

    players.del(id);
    bot.telegram.deleteMessage(ctx.update.callback_query.message.chat.id, ctx.update.callback_query.message.message_id);
});

bot.action(/^ignore?.*/, (ctx) => {
    if(permissions.role(ctx.from.id) != "admin"){return;}

    let id = ctx.match[0].split("?")[1];

    bot.telegram.sendMessage(id, "ВАЖНОЕ СООБЩЕНИЕ! -> Вы заигнорены по разрешению админа!");
    quiz.answer(id, "ignore");

    bot.telegram.deleteMessage(ctx.update.callback_query.message.chat.id, ctx.update.callback_query.message.message_id);
});

bot.action("clearScoreboard", (ctx) => {
    scoreboard.clear();
    ctx.reply("Скорборд очищен!");

    bot.telegram.deleteMessage(ctx.update.callback_query.message.chat.id, ctx.update.callback_query.message.message_id);
});
// -------------

bot.on(message(), async (ctx) => {
    if(ctx.message.text.startsWith("/") || !players.exists(ctx.chat.id)){return;}

    quiz.answer(ctx.chat.id, ctx.message.text);
});

//setInterval(() => {quiz.tick()}, 1500); // потом

app.get("/players", (req, res) => {
    res.json(JSON.stringify(players.all()));
});

process.on("uncaughtException", (err) => {
    console.log(err);
});

scoreboard.clear();

app.listen(1234);
bot.launch();