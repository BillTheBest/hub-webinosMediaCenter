var current = '#s1',
    isAnimating = false,
    endCurrPage = false,
    endNextPage = false;

$(document).ready(function() {
   init();
});

function init() {
    $('.pt-page').each(function() {
        var $page = $( this );
        $page.data( 'originalClassList', $page.attr( 'class' ) );
    } );

    $(current).addClass('pt-page-current');

    $('#button_s1').on('click', function(){ gotoPageById('#s1'); });
    $('#button_s2').on('click', function(){ gotoPageById('#s2'); });
    $('#button_s3').on('click', function(){ gotoPageById('#s3'); });
    $('#button_s4').on('click', function(){ gotoPageById('#s4'); });
    $('#button_s5').on('click', function(){ gotoPageById('#s5'); });
    $('#button_s6').on('click', function(){ gotoPageById('#s6'); });
}

function onEndAnimation($outpage, $inpage) {
    endCurrPage = false;
    endNextPage = false;
    resetPage($outpage, $inpage);
    isAnimating = false;
}

function resetPage($outpage, $inpage) {
    $outpage.attr('class', $outpage.data('originalClassList'));
    $inpage.attr('class', $inpage.data('originalClassList') + ' pt-page-current');
}

function gotoPageById(id) {
    if (!isAnimating && (current != id)) {
        isAnimating = true;

        var $currPage = $(current);
        var $prevPage = $(id).addClass('pt-page-current'),
            outClass = 'pt-page-moveToBottomEasing pt-page-ontop',
            inClass = 'pt-page-moveFromTop';

        current = id;

        $currPage.addClass(outClass).on('webkitAnimationEnd', function() {
            $currPage.off('webkitAnimationEnd');
            endCurrPage = true;
            if (endNextPage) {
                    onEndAnimation($currPage, $prevPage);
            }
        });
        
        $prevPage.addClass(inClass).on('webkitAnimationEnd', function() {
            $prevPage.off('webkitAnimationEnd');
            endNextPage = true;
            if (endCurrPage) {
                    onEndAnimation($currPage, $prevPage);
            }
        });
    }
}
