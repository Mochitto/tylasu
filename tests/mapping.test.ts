import {expect} from "chai";

import {Child, GenericNode, Mapped, Node} from "../src";
import {SimpleLangLexer} from "./parser/SimpleLangLexer";
import {CharStreams, CommonTokenStream} from "antlr4ts";
import {SetStmtContext, SimpleLangParser} from "./parser/SimpleLangParser";
import {ParserRuleContext} from "antlr4ts/ParserRuleContext";
import {ParseTreeOrigin} from "../src/parsing/parse-tree";
import {ASTNodeFor, GenericParseTreeNode, toAST} from "../src/mapping";

@ASTNodeFor(SetStmtContext)
class MySetStatement extends Node {
    //Explicit mapping
    @Child()
    @Mapped("ID")
    id: Node;
    //Implicit mapping (same name)
    @Child()
    EQUAL: Node;
    //No mapping (name doesn't match)
    @Child()
    set: Node;
    @Child()
    expression: any;
    //Erroneous mapping
    @Child()
    @Mapped("nonExistent")
    nonExistent: Node;
}

describe('Mapping of Parse Trees to ASTs', function() {
    it("Mapping of null/undefined",
        function () {
            expect(toAST(undefined)).to.be.undefined;
            expect(toAST(null)).to.be.undefined;
        });
    it("Generic node",
        function () {
            const node = new ParserRuleContext().toAST();
            expect(node).not.to.be.undefined;
            expect(node instanceof GenericNode).to.be.true;
        });
    it("Node registered declaratively",
        function () {
            const code = "set foo = 123 + 45";
            const lexer = new SimpleLangLexer(CharStreams.fromString(code));
            const parser = new SimpleLangParser(new CommonTokenStream(lexer));
            const cu = parser.compilationUnit();
            const setStmt = cu.statement(0) as SetStmtContext;
            const mySetStatement = setStmt.toAST() as MySetStatement;
            expect(mySetStatement instanceof MySetStatement).to.be.true;
            expect(mySetStatement.origin instanceof ParseTreeOrigin).to.be.true;
            const origin = mySetStatement.origin as ParseTreeOrigin;
            expect(origin.parseTree).to.equal(setStmt);
            expect(mySetStatement.id).not.to.be.undefined;
            expect(mySetStatement.EQUAL).not.to.be.undefined;
            expect(mySetStatement.set).to.be.undefined;
            expect(mySetStatement.expression).not.to.be.undefined;
            expect(mySetStatement.nonExistent).to.be.undefined;

            const expression = mySetStatement.expression as GenericParseTreeNode;
            expect(expression instanceof GenericParseTreeNode).to.be.true;
            expect(expression.childNodes.length).to.equal(3);
        });
});
