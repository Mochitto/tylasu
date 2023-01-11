import {assert, expect} from "chai";

import {ASTTransformer, Child, GenericNode, Mapped, Node} from "../src";
import {SimpleLangLexer} from "./parser/SimpleLangLexer";
import {CharStreams, CommonTokenStream} from "antlr4ts";
import {CompilationUnitContext, DisplayStmtContext, SetStmtContext, SimpleLangParser} from "./parser/SimpleLangParser";
import {ParserRuleContext} from "antlr4ts/ParserRuleContext";
import {ParseTreeOrigin} from "../src/parsing/parse-tree";
import {ASTNodeFor, GenericParseTreeNode, ParseTreeToASTTransformer, toAST} from "../src/mapping";
import {Position} from "../src/model/position";

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

class CU extends Node {
    statements : Node[]
    constructor(statements : Node[] = [], specifiedPosition ?: Position) {
        super(specifiedPosition);
        this.statements = statements;
    }
}

class DisplayIntStatement extends Node {
    value : number;
    constructor(value : number, specifiedPosition ?: Position) {
        super(specifiedPosition);
        this.value = value;
    }
}

class SetStatement extends Node {
    variable : string;
    value : number;
    constructor(variable = "", value = 0, specifiedPosition ?: Position) {
        super(specifiedPosition);
        this.variable = variable;
        this.value = value;
    }
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

describe('ParseTreeToASTTransformer', function () {
    it("Test ParseTree Transformer", function () {
        const code = "set foo = 123\ndisplay 456";
        const lexer = new SimpleLangLexer(CharStreams.fromString(code));
        const parser = new SimpleLangParser(new CommonTokenStream(lexer));
        const pt = parser.compilationUnit();

        const transformer = new ParseTreeToASTTransformer();
        configure(transformer)

        const cu = new CU([
            new SetStatement("foo", 123).withParseTreeNode(pt.statement(0)),
            new DisplayIntStatement(456).withParseTreeNode(pt.statement(1))
        ]).withParseTreeNode(pt);

        const transformedCU = transformer.transform(pt)!;

        // TODO: enable this when PR gets accepted and merged
        // assertASTsAreEqual(cu, transformedCU, considerPosition = true)

        // TODO: port hasValidParents
        // expect(transformedCU.hasValidParents()).to.be.true;

        // TODO: port invalidPositions
        // assert.isNotOk(transformedCU.invalidPositions().firstOrNull());
    });
});

const configure = function(transformer: ASTTransformer) : void {

    transformer.registerNodeFactory(CompilationUnitContext, source => new CU())
        .withChild(
            (source: CompilationUnitContext) => source.statement(),
            (target: CU, child?: Node[]) => target.statements = child!,
            "statements",
            CompilationUnitContext
        );

    transformer.registerNodeFactory<DisplayStmtContext, DisplayIntStatement>(
        DisplayStmtContext,
        source => {
            if (source.exception || source.expression().exception) {
                // We throw a custom error so that we can check that it's recorded in the AST
                throw new Error("Parse error");
            }
            const displayIntStatement = new DisplayIntStatement(parseInt(source.expression().INT_LIT()!.text));
            return displayIntStatement;
        });

    transformer.registerNodeFactory<SetStmtContext, SetStatement>(
        SetStmtContext,
        source => {
            if (source.exception || source.expression().exception) {
                // We throw a custom error so that we can check that it's recorded in the AST
                throw new Error("Parse error");
            }
            const setStatement = new SetStatement();
            setStatement.variable = source.ID().text;
            setStatement.value = parseInt(source.expression().INT_LIT()!.text);
            return setStatement;
        }
    );
}
