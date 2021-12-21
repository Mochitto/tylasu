import {expect} from "chai";

import {Issue, Node, Parser} from "../src";
import {SimpleLangLexer} from "./parser/SimpleLangLexer";
import {CharStream, Lexer, TokenStream} from "antlr4ts";
import {CompilationUnitContext, SimpleLangParser} from "./parser/SimpleLangParser";

class CompilationUnit extends Node {}

class SLParser extends Parser<CompilationUnit, SimpleLangParser, CompilationUnitContext> {
        protected createANTLRLexer(inputStream: CharStream): Lexer {
                return new SimpleLangLexer(inputStream);
        }

        protected createANTLRParser(tokenStream: TokenStream): SimpleLangParser {
                return new SimpleLangParser(tokenStream);
        }

        protected parseTreeToAst(parseTreeRoot: CompilationUnitContext, considerPosition: boolean, issues: Issue[]): CompilationUnit | undefined {
                return new CompilationUnit().withParseTreeNode(parseTreeRoot);
        }
}

describe('Parsing', function() {
    it("ParserRuleContext position",
        function () {
            const code = "set foo = 123";
            const parser = new SLParser();
            const result = parser.parse(code);
            expect(result.root instanceof CompilationUnit).to.be.true;
            expect(result.root.parseTreeNode).to.equal(result.firstStage.root);
            expect(result.code).to.equal(code);
        });
});
