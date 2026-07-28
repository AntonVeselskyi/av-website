" Washed Away Cherry — a minimal light colorscheme
" Anton Veselskyi · https://antonveselskyi.com/cherry/
"
" Install: copy to ~/.vim/colors/ (or ~/.config/nvim/colors/), then run:
"          :colorscheme washed-away-cherry
" True color is recommended: set termguicolors

" This file changes colors only. It does not set a font, font size, or editor font.

" Palette:
"   canvas     #EFD0D8
"   variables  #6D8FA2
"   functions  #6F8F52
"   syntax     #8E163E (with #4C1327 / #A82143 range accents)
"   comments   #C2B2AD


hi clear
if exists("syntax_on")
  syntax reset
endif

set background=light
let g:colors_name = "washed-away-cherry"

" Editor chrome
hi Normal        guifg=#8E163E guibg=#EFD0D8 ctermfg=89  ctermbg=224
hi NormalFloat   guifg=#4C1327 guibg=#F6E1E6 ctermfg=52  ctermbg=225
hi FloatBorder   guifg=#B7798A guibg=#F6E1E6 ctermfg=132 ctermbg=225
hi NonText       guifg=#D8AAB6 guibg=NONE    ctermfg=181
hi EndOfBuffer   guifg=#D8AAB6 guibg=NONE    ctermfg=181
hi LineNr        guifg=#B7798A guibg=NONE    ctermfg=132
hi CursorLineNr  guifg=#A82143 guibg=#F6E1E6 ctermfg=124 ctermbg=225
hi CursorLine    guibg=#F6E1E6 ctermbg=225
hi CursorColumn  guibg=#F6E1E6 ctermbg=225
hi ColorColumn   guibg=#E4BBC5 ctermbg=181
hi Visual        guifg=#4C1327 guibg=#F08BAA ctermfg=52  ctermbg=211
hi VisualNOS     guibg=#F3B7C8 ctermbg=217
hi Cursor        guifg=#EFD0D8 guibg=#4C1327 ctermfg=224 ctermbg=52
hi MatchParen    guifg=#6F8F52 guibg=#F6E1E6 ctermfg=65  ctermbg=225
hi SignColumn    guibg=#EFD0D8 ctermbg=224
hi Folded        guifg=#986174 guibg=#F6E1E6 ctermfg=96  ctermbg=225
hi FoldColumn    guifg=#B7798A guibg=#EFD0D8 ctermfg=132 ctermbg=224
hi VertSplit     guifg=#D49BAB guibg=NONE    ctermfg=174
hi WinSeparator  guifg=#D49BAB guibg=NONE    ctermfg=174

hi StatusLine    guifg=#F8F2F3 guibg=#7F1737 ctermfg=255 ctermbg=89
hi StatusLineNC  guifg=#EFD0D8 guibg=#986174 ctermfg=224 ctermbg=96
hi TabLine       guifg=#986174 guibg=#F6E1E6 ctermfg=96  ctermbg=225
hi TabLineSel    guifg=#F8F2F3 guibg=#8E163E ctermfg=255 ctermbg=89
hi TabLineFill   guibg=#F6E1E6 ctermbg=225

hi Pmenu         guifg=#4C1327 guibg=#F8F2F3 ctermfg=52  ctermbg=255
hi PmenuSel      guifg=#4C1327 guibg=#F08BAA ctermfg=52  ctermbg=211
hi PmenuSbar     guibg=#E4BBC5 ctermbg=181
hi PmenuThumb    guibg=#986174 ctermbg=96

hi Search        guifg=#4C1327 guibg=#F08BAA ctermfg=52  ctermbg=211
hi IncSearch     guifg=#F8F2F3 guibg=#A82143 ctermfg=255 ctermbg=124
hi CurSearch     guifg=#F8F2F3 guibg=#A82143 ctermfg=255 ctermbg=124

hi Directory     guifg=#6D8FA2 ctermfg=67
hi Title         guifg=#A82143 ctermfg=124
hi Question      guifg=#6F8F52 ctermfg=65
hi MoreMsg       guifg=#6F8F52 ctermfg=65
hi ModeMsg       guifg=#A82143 ctermfg=124
hi WarningMsg    guifg=#986174 ctermfg=96
hi ErrorMsg      guifg=#A82143 guibg=NONE ctermfg=124
hi SpecialKey    guifg=#D8AAB6 ctermfg=181
hi Whitespace    guifg=#D8AAB6 ctermfg=181
hi Conceal       guifg=#B7798A ctermfg=132

" Syntax: only variables, functions, and comments leave the cherry range
hi Comment        guifg=#C2B2AD ctermfg=145
hi SpecialComment guifg=#C2B2AD ctermfg=145

hi Identifier    guifg=#6D8FA2 ctermfg=67
hi Function      guifg=#6F8F52 ctermfg=65

hi Constant      guifg=#8E163E ctermfg=89
hi String        guifg=#8E163E ctermfg=89
hi Character     guifg=#8E163E ctermfg=89
hi Number        guifg=#8E163E ctermfg=89
hi Float         guifg=#8E163E ctermfg=89
hi Boolean       guifg=#8E163E ctermfg=89

hi Statement     guifg=#8E163E ctermfg=89
hi Conditional   guifg=#8E163E ctermfg=89
hi Repeat        guifg=#8E163E ctermfg=89
hi Label         guifg=#8E163E ctermfg=89
hi Operator      guifg=#7F1737 ctermfg=89
hi Keyword       guifg=#8E163E ctermfg=89
hi Exception     guifg=#8E163E ctermfg=89

hi PreProc       guifg=#A82143 ctermfg=124
hi Include       guifg=#A82143 ctermfg=124
hi Define        guifg=#A82143 ctermfg=124
hi Macro         guifg=#A82143 ctermfg=124
hi PreCondit     guifg=#A82143 ctermfg=124

hi Type          guifg=#8E163E ctermfg=89
hi BuiltinType   guifg=#8E163E ctermfg=89
hi StorageClass  guifg=#8E163E ctermfg=89
hi Structure     guifg=#8E163E ctermfg=89
hi Typedef       guifg=#8E163E ctermfg=89

hi Special       guifg=#A82143 ctermfg=124
hi SpecialChar   guifg=#A82143 ctermfg=124
hi Tag           guifg=#8E163E ctermfg=89
hi Delimiter     guifg=#7F1737 ctermfg=89
hi Debug         guifg=#A82143 ctermfg=124
hi Underlined    guifg=#6D8FA2 ctermfg=67
hi Ignore        guifg=#D8AAB6 ctermfg=181
hi Error         guifg=#A82143 guibg=NONE ctermfg=124
hi Todo          guifg=#F8F2F3 guibg=#A82143 ctermfg=255 ctermbg=124

" Diff / VCS
hi DiffAdd       guifg=#4C1327 guibg=#DCE4D5 ctermfg=52 ctermbg=188
hi DiffChange    guifg=#4C1327 guibg=#D4DFE4 ctermfg=52 ctermbg=188
hi DiffDelete    guifg=#A82143 guibg=#F3B7C8 ctermfg=124 ctermbg=217
hi DiffText      guifg=#4C1327 guibg=#F08BAA ctermfg=52 ctermbg=211

" C / C++ specifics
hi link cType            BuiltinType
hi link cStorageClass    StorageClass
hi link cStructure       Structure
hi link cppStructure     Structure
hi link cCustomClass     Structure
hi link cppSTLnamespace  Structure
hi link cppSTLtype       Type
hi link cppSTLfunction   Function
hi link cUserLabel       Label
hi link cEnumeration     Constant

" Neovim Treesitter and LSP semantic tokens
if has('nvim')
  hi link @comment             Comment
  hi link @string              String
  hi link @character           Character
  hi link @number              Number
  hi link @boolean             Boolean
  hi link @keyword             Keyword
  hi link @keyword.function    Keyword
  hi link @keyword.return      Keyword
  hi link @conditional         Conditional
  hi link @repeat              Repeat
  hi link @operator            Operator
  hi link @punctuation         Delimiter
  hi link @function            Function
  hi link @function.call       Function
  hi link @function.macro      Macro
  hi link @method              Function
  hi link @method.call         Function
  hi link @constructor         Structure
  hi link @variable            Identifier
  hi link @variable.builtin    Identifier
  hi link @parameter           Identifier
  hi link @field               Identifier
  hi link @property            Identifier
  hi link @type                Type
  hi link @type.builtin        BuiltinType
  hi link @type.definition     Typedef
  hi link @namespace           Structure
  hi link @constant            Constant
  hi link @constant.builtin    Constant
  hi link @constant.macro      Macro
  hi link @preproc             PreProc
  hi link @include             Include
  hi link @define              Define
  hi link @label               Label
  hi link @tag                 Tag
  hi link @text.todo           Todo

  hi link @variable.parameter  Identifier
  hi link @variable.member     Identifier
  hi link @module              Structure
  hi link @function.method     Function

  hi link @lsp.type.class      Structure
  hi link @lsp.type.struct     Structure
  hi link @lsp.type.namespace  Structure
  hi link @lsp.type.enum       Constant
  hi link @lsp.type.enumMember Constant
  hi link @lsp.type.function   Function
  hi link @lsp.type.method     Function
  hi link @lsp.type.macro      Macro
  hi link @lsp.type.type       Type
  hi link @lsp.type.typeParameter Special
  hi link @lsp.type.variable   Identifier
  hi link @lsp.type.parameter  Identifier
  hi link @lsp.type.property   Identifier

  hi DiagnosticError guifg=#A82143 ctermfg=124
  hi DiagnosticWarn  guifg=#986174 ctermfg=96
  hi DiagnosticInfo  guifg=#6D8FA2 ctermfg=67
  hi DiagnosticHint  guifg=#6F8F52 ctermfg=65
endif
