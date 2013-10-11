encrypted = (name) ->
  name.substr(0, 9) is 'PAYPAYPAY'
decrypted = (name) ->
  name.substr(0, 12) is 'VIEWVIEWVIEW'
name = (name) ->
  if encrypted(name) then name.substr(13) else if decrypted(name) then name.substr(12) else name
price = (name) ->
  if encrypted(name) then parseInt(name.substr(9, 4)) / 100 else 0
decrypt = (name) ->
  if encrypted(name) then 'VIEWVIEWVIEW' + name.substr(13) else name

module.exports = {encrypted, decrypted, name, price, decrypt}
